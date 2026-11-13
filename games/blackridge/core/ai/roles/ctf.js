// core/ai/roles/ctf.js [W7] — CTF's role system with dynamic reassignment
// (bot_ai.md Part 7; PVP_BUILD_PLAN C9): attacker / escort / defender /
// interceptor / returner, the carrier state, the S0–S5 situation table, the
// BOTH_CARRY hold, cutoff-not-chase interception, and the stall breaker.
//
// Everything read is Tier W (flag states, dropped-flag positions, the
// 3 s / ±6 m carrier beacon, score/clock), Tier R (team contacts) or the
// bot's OWN percept. The enemy carrier's position is ONLY ever the beacon.
// The human is a wildcard the commander plans around, never a unit it
// commands: its effective role is inferred from teammate-tier facts and the
// matching quota is reduced (bot_ai §7.3).

const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const CUTOFF_MARGIN_S = 1.5;     // §7.8 — arrive and set up, not mid-stride
const STALL_WINDOW_S = 12.0;     // §7.6 — <5 m progress in 12 s → commit
const STALL_COMMIT_S = 10.0;
const HOLD_BAND = [10, 18];      // §7.6 — BOTH_CARRY hold ring

function normState(s) {
  const u = String(s || "").toUpperCase();
  if (u === "AT_STAND" || u === "HOME" || u === "ATSTAND" || u === "RETURNED") return "HOME";
  if (u === "CARRIED" || u === "TAKEN") return "CARRIED";
  if (u === "DROPPED") return "DROPPED";
  return "HOME";
}

function bandOf(body) { return BAND_BY_ARCH[body.archetype] || [15, 35]; }

function driveTo(ctx, b, dest, lengthOnly) {
  const { api, t } = ctx;
  const rec = b.rec, body = b.body;
  const cost = lengthOnly ? null : api.routeCost(bandOf(body));
  const stale = !rec.route || !rec.route.to || api.hdist(rec.route.to, dest) > 4 ||
    (lengthOnly && !rec.route._lengthOnly);
  if (stale && (t - rec.routeAt >= ctx.latchS.route || !rec.route ||
      api.hdist(rec.route.to, dest) > 12 || lengthOnly)) {
    rec.route = api.buildRoute(body.pos, dest, cost);
    if (rec.route) rec.route._lengthOnly = !!lengthOnly;
    rec.routeAt = t;
  }
  const anchor = rec.route ? api.followRoute(rec, body) : null;
  return anchor || dest;
}

// a defender's post: a waypoint on an approach lane 8–18 m from the stand
function approachAnchor(ctx, standHome, laneIds, k) {
  const { api, g } = ctx;
  if (!laneIds || !laneIds.length) return standHome;
  const L = g.byId[laneIds[k % laneIds.length]];
  if (!L) return standHome;
  // order waypoints stand-outward
  const fwd = api.hdist(L.wp[0], standHome) <= api.hdist(L.wp[L.wp.length - 1], standHome);
  let best = null, bestScore = Infinity;
  for (let i = 0; i < L.wp.length; i++) {
    const wp = L.wp[fwd ? i : L.wp.length - 1 - i];
    const d = api.hdist(wp, standHome);
    if (d >= 8 && d <= 18) {
      const s = Math.abs(d - 12);
      if (s < bestScore) { bestScore = s; best = wp; }
    }
  }
  return best || L.wp[fwd ? Math.min(1, L.wp.length - 1) : Math.max(0, L.wp.length - 2)];
}

// §7.8 — interceptors cut off, they do not chase. Returns {wp, margin}|null.
function solveCutoff(ctx, b, beacon, enemyStandHome) {
  const { api, g } = ctx;
  const nl = api.nearestLane(beacon.pos);
  if (!nl) return null;
  const jStand = api.nearestJunction(enemyStandHome);
  // carrier's next junction: the end of its lane nearer (by graph) the stand
  const costA = api.junctionPath(nl.lane.a, jStand, null);
  const costB = api.junctionPath(nl.lane.b, jStand, null);
  const nextJ = (costA ? costA.cost : Infinity) <= (costB ? costB.cost : Infinity) ? nl.lane.a : nl.lane.b;
  const p = api.junctionPath(nextJ, jStand, null);
  // remaining polyline: beacon → nextJ → … → stand
  const wps = [api.junctionPos(nextJ)];
  if (p) {
    const flat = api.flattenLegs(p.legs);
    for (const w of flat.wps) wps.push(w);
  }
  wps.push(enemyStandHome);
  let along = 0, prev = beacon.pos;
  let best = null, bestMargin = -Infinity;
  for (const wp of wps) {
    along += api.hdist(prev, wp);
    prev = wp;
    // conservative: assume the carrier WALKS (4.6) — under-committing errs
    // toward the human (§7.8.2); we blend walk/sprint (5.5) for ourselves
    const etaThem = along / ctx.speeds.walk;
    const etaMe = api.navDist(b.body.pos, wp) / ctx.speeds.blend;
    const margin = etaThem - etaMe;
    if (margin > bestMargin) { bestMargin = margin; best = wp; }
  }
  if (!best || bestMargin < CUTOFF_MARGIN_S) return null;
  return { wp: best, margin: bestMargin };
}

// escort stations solved against the carrier's route (§7.7)
function stations(ctx, carrierPos, routeWps) {
  const { api } = ctx;
  const out = [];
  let ci = 0, cd = Infinity;
  const wps = routeWps && routeWps.length ? routeWps : [carrierPos];
  for (let i = 0; i < wps.length; i++) {
    const d = api.hdist(wps[i], carrierPos);
    if (d < cd) { cd = d; ci = i; }
  }
  const along = (dist) => {
    let acc = 0, prev = carrierPos;
    if (dist >= 0) {
      for (let i = ci; i < wps.length; i++) {
        acc += api.hdist(prev, wps[i]);
        prev = wps[i];
        if (acc >= dist) return wps[i];
      }
      return wps[wps.length - 1];
    }
    for (let i = ci; i >= 0; i--) {
      acc += api.hdist(prev, wps[i]);
      prev = wps[i];
      if (acc >= -dist) return wps[i];
    }
    return wps[0];
  };
  const point = along(15);
  out.push(point); // POINT — 12–18 m ahead
  // WING — lateral on the route direction
  const dirRef = point !== carrierPos ? point : (wps[Math.min(ci + 1, wps.length - 1)] || carrierPos);
  let dx = dirRef[0] - carrierPos[0], dz = dirRef[2] - carrierPos[2];
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  out.push([carrierPos[0] - dz * 10, carrierPos[1], carrierPos[2] + dx * 10]);
  out.push(along(-12)); // TRAIL
  // enforce ≥8 m pairwise (one grenade never takes two escorts — §7.7)
  for (let i = 1; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      if (api.hdist(out[i], out[j]) < 8) {
        out[i] = [out[i][0] - dz * 9, out[i][1], out[i][2] + dx * 9];
      }
    }
  }
  return out;
}

export function assign(ctx) {
  const { m, t, api, bots, human, posture, sit } = ctx;
  const R = api.REASONS;
  const flags = m.state.flags || [];
  const B = m.arena && m.arena.bounds ? m.arena.bounds : null;
  const mapDiag = B ? Math.hypot(B.max[0] - B.min[0], B.max[2] - B.min[2]) : 90;

  let ourFlag = null, theirFlag = null;
  for (const f of flags) {
    if (f.team === ctx.team) ourFlag = f; else theirFlag = f;
  }
  if (!ourFlag || !theirFlag) {
    // W8 not landed / no flag data: duty passthrough only
    for (const b of bots) {
      const duty = b.actor.duty;
      api.write(b.rec, b.body, {
        role: "lane", reason: R.DUTY,
        anchor: duty && duty.target ? duty.target.slice() : null,
        priority: duty ? 0.6 : 0, firePolicy: "free", posture,
      });
    }
    return;
  }

  const ourS = normState(ourFlag.state);
  const theirS = normState(theirFlag.state);
  const ourStand = ourFlag.home;
  const theirStand = theirFlag.home;
  const ownApproach = ctx.team === 0 ? (ctx.g.approaches.A_STAND || []) : (ctx.g.approaches.B_STAND || []);

  // who carries? (flag.carrier is Tier W — the HUD names the carrier's team)
  const carrierWho = theirS === "CARRIED" ? theirFlag.carrier : null; // our side's carrier
  const humanIsCarrier = carrierWho === "P" && ctx.team === 0;
  let carrierBot = null;
  if (carrierWho != null && !humanIsCarrier) {
    for (const b of bots) if (b.body.id === carrierWho) carrierBot = b;
  }
  const enemyCarrying = ourS === "CARRIED";
  const beacon = enemyCarrying ? api.beacons.get(ourFlag.id) || null : null;

  // human wildcard inference (never commanded)
  let humanRole = null;
  let humanPos = null;
  if (human && human.actor.alive && ctx.team === 0) {
    humanPos = m.posOf(human.actor);
    if (humanIsCarrier) humanRole = "carry";
    else if (humanPos && api.hdist(humanPos, ourStand) <= 15) humanRole = "defend";
    else humanRole = "attack";
  }

  // ---- quotas per situation (bot_ai §7.3), human-adjusted
  const q = { attack: 0, defend: 0, escort: 0, intercept: 0, return: 0, float: 0 };
  if (ourS === "HOME" && theirS === "HOME") { q.attack = 2; q.defend = 2; q.float = 1; }               // S0
  else if (ourS === "HOME" && theirS === "CARRIED") { q.escort = 2; q.defend = 2; q.float = 1; }        // S1
  else if (ourS === "HOME" && theirS === "DROPPED") { q.attack = 2; q.defend = 2; q.float = 1; }        // S5
  else if (ourS === "CARRIED" && theirS === "HOME") { q.attack = 1; q.defend = 1; q.intercept = 3; }    // S2
  else if (ourS === "CARRIED" && theirS === "CARRIED") { q.escort = 1; q.intercept = 3; q.float = 1; }  // S3
  else if (ourS === "CARRIED" && theirS === "DROPPED") { q.attack = 1; q.intercept = 3; q.float = 1; }
  else if (ourS === "DROPPED") {
    // S4 overlay: 1–2 nearest return; the rest per the matching row
    q.return = Math.min(2, Math.max(1, bots.length - 2));
    if (theirS === "CARRIED") { q.escort = 2; q.defend = 1; }
    else if (theirS === "DROPPED") { q.attack = 1; q.defend = 1; q.float = 1; }
    else { q.attack = 1; q.defend = 2; }
  }

  // §7.10 score/clock: stop defending when a capture is unanswerable; sit on
  // a winning lead. §3.3 respawn ledger reweights toward attack.
  const remaining = Math.max(0, (sit.timeLimit || 720) - sit.elapsed);
  const tRound = 35;
  if (sit.them - sit.us >= 2 && remaining < tRound * 2) {
    q.attack = Math.max(q.attack, 3); q.defend = Math.min(q.defend, 1); q.escort = Math.min(q.escort, 1);
  } else if (sit.us - sit.them >= 2 && remaining < 60) {
    q.defend = Math.max(q.defend, 4); q.attack = Math.min(q.attack, 1); q.float = 0;
  } else if (posture === "press" && ourS === "HOME") {
    q.attack = Math.max(q.attack, q.attack + 1); q.defend = Math.max(0, q.defend - 1);
  }
  if (humanRole === "defend") q.defend = Math.max(0, q.defend - 1);
  else if (humanRole === "attack") q.attack = Math.max(0, q.attack - 1);

  // ---- pool = bots minus the carrier (a state, not an assignment)
  const pool = [];
  for (const b of bots) if (b !== carrierBot) pool.push(b);

  const inFight = (b) => (api.engagedNow(b.body) ? 1 : 0);
  const hpFrac = (b) => (b.body.hp || 100) / 100;

  // pre-solve cutoffs once per bot (used by utility AND the write)
  const cut = new Map();
  if (enemyCarrying && beacon) {
    for (const b of pool) cut.set(b, solveCutoff(ctx, b, beacon, theirStand));
  }

  // dropped-flag return target
  const dropPos = ourS === "DROPPED" && ourFlag.pos ? ourFlag.pos : null;
  const theirDropPos = theirS === "DROPPED" && theirFlag.pos ? theirFlag.pos : null;

  const util = {
    return: (b) => (dropPos ? 2.0 * (1 - api.navDist(b.body.pos, dropPos) / mapDiag) : -9),
    intercept: (b) => 1.4 * (cut.get(b) ? 1 : 0) + 0.4 * hpFrac(b),
    escort: (b) => {
      const cp = humanIsCarrier ? humanPos : (carrierBot ? carrierBot.body.pos : null);
      if (!cp) return -9;
      return 1.5 * (1 - api.navDist(b.body.pos, cp) / mapDiag) + 0.7 * hpFrac(b) - 1.0 * inFight(b);
    },
    defend: (b) => 1.3 * (1 - api.navDist(b.body.pos, ourStand) / mapDiag) + 0.3 * (1 - hpFrac(b)),
    attack: (b) => 1.2 + 0.8 * hpFrac(b) - 0.9 * api.navDist(b.body.pos, theirStand) / mapDiag,
    float: () => 0.1,
  };

  // greedy fill, highest-leverage roles first (u(return) largest on purpose)
  const order = ["return", "intercept", "escort", "defend", "attack", "float"];
  const assigned = new Map(); // b → role
  for (const role of order) {
    let want = q[role];
    // F1 latch-break selectivity: with the W7 preempt-limiter fixed, Tier-W
    // events actually deliver preempt passes — and DEATHS are Tier-W, so a
    // team preempts every few seconds all match. A preempt that overrides
    // every latch reshuffled the whole team that often, and attack runs
    // never completed (measured: captures DROPPED after the limiter fix —
    // 6/20 capture-less seeds). Only the flag-critical roles may break a
    // live latch on preempt (AC-15's duel-breaking intercept, S4's return);
    // the rest honor §3.4 and rebalance when their latch expires.
    const latchBreak = role === "return" || role === "intercept";
    while (want > 0 && assigned.size < pool.length) {
      let best = null, bestU = -Infinity;
      for (const b of pool) {
        if (assigned.has(b)) continue;
        // role latch (§3.4): a latched bot resists reassignment unless a
        // preempting event fired this pass AND the role may break latches
        if (!(api.preempt && latchBreak) && api.latched(b.rec) && b.rec.role !== role) continue;
        const u = util[role](b);
        if (u > bestU) { bestU = u; best = b; }
      }
      if (!best || bestU <= -9) break;
      assigned.set(best, role);
      want--;
    }
  }
  // F1 (T-CTF-1 finding): the attack quota is the capture engine — the fill
  // order tries return/intercept/escort/defend first, and with permanent
  // latches a small pool can leave attack COMPLETELY unfilled forever (a
  // lone bot latched 'defend' never grabbed a wholly undefended flag). On a
  // preempt pass, if attack got zero fills, steal the best candidate from
  // the lower-leverage holders (defend/float/lane).
  if (api.preempt && q.attack > 0 && ourS !== "CARRIED") {
    let hasAttack = false;
    for (const r2 of assigned.values()) if (r2 === "attack") hasAttack = true;
    for (const b of pool) if (!assigned.has(b) && b.rec.role === "attack") hasAttack = true;
    if (!hasAttack) {
      let best = null, bestU = -Infinity;
      for (const b of pool) {
        const cur = assigned.get(b);
        if (cur && cur !== "defend" && cur !== "float") continue;
        if (b.rec.role != null && !["defend", "float", "lane", "attack"].includes(b.rec.role)) continue;
        const u = util.attack(b);
        if (u > bestU) { bestU = u; best = b; }
      }
      if (best) assigned.set(best, "attack");
    }
  }
  // leftovers float
  for (const b of pool) if (!assigned.has(b)) assigned.set(b, "float");

  // ---- carrier route (for escorts): the human's inferred route, or the
  // carrier bot's own route (built below before escorts read it)
  let carrierRouteWps = null;
  let carrierPos = null;

  // ================================================================ carrier
  if (carrierBot) {
    const b = carrierBot;
    const rec = b.rec, body = b.body;
    carrierPos = body.pos;
    const canScore = ourS === "HOME"; // rule 2 — own flag must be home
    if (!canScore) {
      // S3/S2-hold: 10–18 m off our stand, near enough to score the moment
      // our flag comes home, far enough not to be camped (§7.6)
      const hold = approachAnchor(ctx, ourStand, ownApproach, 0);
      const d = api.hdist(hold, ourStand);
      const anchor = d >= HOLD_BAND[0] && d <= HOLD_BAND[1] ? hold
        : [ourStand[0] + 14 * ((hold[0] - ourStand[0]) / (d || 1)), ourStand[1],
           ourStand[2] + 14 * ((hold[2] - ourStand[2]) / (d || 1))];
      rec.route = null;
      api.write(rec, body, {
        role: "carry", reason: R.HOLD_NEAR_STAND, anchor, anchorKind: "station",
        priority: 0.8, firePolicy: "free", posture,
        noRetreat: true, noFlank: true, noGrenade: true, holdS: 2,
      });
    } else {
      // stall breaker (§7.6): <5 m progress toward the stand in 12 s → commit
      const dHome = api.navDist(body.pos, ourStand);
      if (t - rec.progT >= STALL_WINDOW_S) {
        if (rec.progD - dHome < 5 && t >= rec.stallUntil) rec.stallUntil = t + STALL_COMMIT_S;
        rec.progD = dHome; rec.progT = t;
      } else if (dHome < rec.progD - 5) { rec.progD = dHome; rec.progT = t; }
      const stalled = t < rec.stallUntil;
      // F1 (T-CTF-1 monotonic-window finding): the junction-graph route
      // detoured the carrier AWAY from home by up to 7.9 m inside a 10 s
      // window (same lane-approximation error as the returner's). Inside
      // 30 m of home the anchor is the stand itself — the real nav path is
      // exact and monotone at that range; beyond it the exposure-aware
      // route still picks the lane.
      // F1 (AC-13 monotonic bar): the carrier takes NO lane-graph route at
      // all — every cost variant detoured it away from home by 8-10 m inside
      // a 10 s window (junction-path approximation + lane flattening, even
      // lengthOnly). The anchor is the stand itself: the bot's REAL nav path
      // is optimal, so nav-distance-home falls monotonically by construction.
      // The carrier's safety is the escorts' job (§7.7); its own job is the
      // shortest walk home. Escort stations fall back to carrier-pos rings.
      const anchor = [ourStand[0], ourStand[1], ourStand[2]];
      rec.route = null;
      api.write(rec, body, {
        role: "carry", reason: stalled ? R.STALL_BREAKER : R.CARRY,
        anchor, anchorKind: "stand", routeUse: false,
        priority: stalled ? 1.0 : 0.95,
        firePolicy: "defensive", selfDefenseM: 12, posture,
        noRetreat: true, noFlank: true, noGrenade: true, holdS: 2,
      });
      carrierRouteWps = rec.route ? rec.route.wps : null;
      // honest calls (§7.6): flag's up / carrier sector / escort me
      if (t - rec.lastBarkT > 6) {
        rec.lastBarkT = t;
        api.bark(body, rec._barkedTaken ? "carrier" : "flagtaken");
        rec._barkedTaken = true;
      }
      if (body.hp < 50 && api.engagedNow(body)) {
        api.bark(body, "escortme");
        if (ctx.gid) api.comms.call(ctx.gid, "escortme", body.id, t);
      }
    }
  } else if (humanIsCarrier && humanPos) {
    carrierPos = humanPos;
    const r = api.buildRoute(humanPos, [ourStand[0], ourStand[1], ourStand[2]], null);
    carrierRouteWps = r ? r.wps : null;
  }

  // ================================================================ the pool
  let defendK = 0, escortK = 0;
  const escortStations = carrierPos
    ? stations(ctx, carrierPos, carrierRouteWps) : null;

  for (const b of pool) {
    const role = assigned.get(b);
    const rec = b.rec, body = b.body;
    const engaged = api.engagedNow(body);
    const combatNow = body.state === "combat" || body.state === "flank" || body.state === "suppress";
    // one-shot break bookkeeping (see the return/intercept branches): a new
    // engagement, or leaving the breaking roles, re-arms the break.
    if ((!combatNow && !engaged) || (role !== "return" && role !== "intercept")) rec._brokeFor = null;

    if (role === "return" && dropPos) {
      // F1 (T-CTF-4 finding): the junction-graph route badly over-detours
      // short trips (measured: nav 17.7 m to the drop, lane route walked the
      // returner to 22.4 m AWAY before turning). Inside 25 m the anchor is
      // the drop itself — botfsm's real nav path is exact at that range.
      // navDistApprox over-estimates in-yard trips (junction detour clamped
      // to 3x euclid — measured 45 for a real 17.7 m trip), so the direct
      // gate also accepts a short EUCLID trip: the anchor only seeds the
      // bot's REAL nav path, which routes around any wall correctly.
      const ndDrop = api.navDist(body.pos, dropPos);
      const direct = ndDrop <= 25 || api.hdist(body.pos, dropPos) <= 20;
      const anchor = direct ? [dropPos[0], dropPos[1], dropPos[2]]
        : driveTo(ctx, b, [dropPos[0], dropPos[1], dropPos[2]]);
      if (direct) rec.route = null;
      // F1 (T-CTF-2-class finding): a role write during the §7.9 hit-lock
      // used to consume the one-shot break (rec.role changed, breakFight
      // false) — the break now re-arms until it actually fires once.
      const hardBreak = combatNow && !api.neverBreak(body) &&
        ndDrop <= 40 && (rec.role !== "return" || !rec._brokeFor);
      api.write(rec, body, {
        role: "return", reason: R.RETURN_FLAG, anchor, anchorKind: "flag", routeUse: !direct,
        priority: 1.0, firePolicy: "defensive", selfDefenseM: 10, posture,
        noRetreat: true, breakFight: hardBreak, rearm: hardBreak,
      });
      if (hardBreak) rec._brokeFor = "return";
      if (rec._lastReturnBark == null || t - rec._lastReturnBark > 8) {
        rec._lastReturnBark = t; api.bark(body, "returning");
      }
      continue;
    }

    if (role === "intercept") {
      const c = cut.get(b);
      if (c) {
        // F1 (T-CTF-2 finding): with preempts latched, a stale death event
        // can assign intercept while the duelist is inside the §7.9 hit-lock
        // — the one-shot role-transition break was consumed with breakFight
        // false and never re-offered. The break now re-arms every pass until
        // it actually fires once for this engagement.
        // (combatNow || engaged): during the very no-hit gap that makes the
        // break §7.9-legal, the FSM can sit one state outside the strict
        // combat set while the percept engagement is still live — the break
        // must not miss its only legal window over that technicality.
        const hardBreak = (combatNow || engaged) && !api.neverBreak(body) &&
          (rec.role !== "intercept" || rec._brokeFor !== "intercept");
        rec.route = null;
        api.write(rec, body, {
          role: "intercept", reason: R.CUTOFF_FEASIBLE, anchor: c.wp.slice(),
          anchorKind: "cutoff", priority: 0.9, firePolicy: "free", posture,
          noFlank: true, breakFight: hardBreak, rearm: hardBreak, holdS: 2,
        });
        if (hardBreak) rec._brokeFor = "intercept";
        if (rec._lastIntBark == null || t - rec._lastIntBark > 10) {
          rec._lastIntBark = t; api.bark(body, "intercept");
        }
      } else {
        // §7.8.4 — a hopeless chase is abandoned NOW: counter-attack instead
        const dest = theirDropPos || theirStand;
        const anchor = driveTo(ctx, b, [dest[0], dest[1], dest[2]]);
        api.write(rec, body, {
          role: "attack", reason: R.CUTOFF_INFEASIBLE, anchor, anchorKind: "flag",
          routeUse: true, priority: engaged ? 0.45 : 0.8, firePolicy: "free", posture,
        });
      }
      continue;
    }

    if (role === "escort" && escortStations) {
      const stn = escortStations[Math.min(escortK, escortStations.length - 1)];
      escortK++;
      rec.route = null;
      api.write(rec, body, {
        role: "escort",
        reason: humanIsCarrier ? R.CARRIER_NEEDS_ESCORT : R.ESCORT_STATION,
        anchor: stn.slice(), anchorKind: "station",
        priority: 0.75, firePolicy: "free", posture,
        noRetreat: api.hdist(body.pos, carrierPos) <= 20, holdS: 2,
      });
      continue;
    }

    if (role === "defend") {
      const anchor = approachAnchor(ctx, ourStand, ownApproach, defendK);
      defendK++;
      const standThreat = api.comms.contactWeightNear(ctx.gid, t, ourStand[0], ourStand[2], 15) > 0;
      const leashed = api.hdist(body.pos, anchor) > 24;
      rec.route = null;
      api.write(rec, body, {
        role: "defend", reason: leashed ? R.LEASH : R.DEFEND_STAND,
        anchor: anchor.slice(), anchorKind: "station",
        priority: leashed ? 0.85 : (engaged ? 0.5 : 0.7),
        firePolicy: "free", posture,
        noRetreat: standThreat, noFlank: true,
      });
      continue;
    }

    if (role === "attack") {
      const dest = theirDropPos || theirStand;
      const near = api.hdist(body.pos, dest) <= 8;
      const anchor = near ? [dest[0], dest[1], dest[2]] : driveTo(ctx, b, [dest[0], dest[1], dest[2]]);
      api.write(rec, body, {
        role: "attack", reason: R.ATTACK_FLAG,
        anchor, anchorKind: "flag", routeUse: !near,
        // §7.4: the grab is worth a trade — priority 0.95 inside 8 m
        priority: near ? 0.95 : (engaged ? 0.45 : 0.8),
        firePolicy: "free", posture,
      });
      continue;
    }

    // float: midfield presence biased toward the enemy stand (60 %)
    const mx = ourStand[0] * 0.4 + theirStand[0] * 0.6;
    const mz = ourStand[2] * 0.4 + theirStand[2] * 0.6;
    const anchor = driveTo(ctx, b, [mx, 0, mz]);
    api.write(rec, body, {
      role: "lane", reason: R.LANE_QUOTA, anchor, anchorKind: "lane", routeUse: true,
      priority: engaged ? 0.45 : 0.7, firePolicy: "free", posture,
    });
  }
}
