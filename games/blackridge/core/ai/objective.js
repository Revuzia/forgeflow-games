// core/ai/objective.js [W7] — the commander: the per-team objective layer
// that sits ABOVE the audited combat FSM (PVP_BUILD_PLAN C9/C10, Part 3.7;
// bot_ai.md Parts 2–9). THREE-free, deterministic, Node-runnable.
//
// ONE SENTENCE: the commander decides WHERE each bot should be and WHETHER
// it may shoot; the existing FSM decides everything about HOW it fights.
//
// THE MONOTONIC FAIRNESS RULE (Part 3.7 — binding): this layer may move a
// bot's feet and may withhold its fire. It may NEVER grant information,
// speed, accuracy, reaction, health, or ammunition. Every knob written here
// is one-directional; the audited fairness surface stays an upper bound and
// objective.selftest.cjs asserts it mechanically (AC-32/AC-34).
//
// Information tiers (Part 3.8) — every fact used here belongs to exactly one:
//   P  the bot's OWN percept (earned; harvested into the Tier-R ring)
//   R  the radio (comms.js, per commsGroup; ABSENT in FFA — group of one)
//   W  the rules broadcast: score, clock, phase, flag states + dropped-flag
//      positions, the 3 s / ±6 m carrier beacon, killfeed-derived liveness —
//      exactly what the HUD publishes to the human (PUBLIC_FACTS below).
// BAN LIST (never read): enemy hp / weapon / ammo / aim direction, enemy
// exact position without perception or a beacon, enemy respawn timers,
// another bot's _obj. Enemy actor objects are touched ONLY for
// {actorId, team, alive}. Teammate reads go through m.posOf (your team —
// the HUD shows the same pips).
//
// Invocation: slot 3a of the sim tick — inside aiStep, before squad._tick
// (bot_ai §2.4). Commander cadence 2 Hz per team, staggered (team 0 on
// tick%30===0, team 1 on %30===15; FFA solo passes on %30===0). Tier-W
// objective events force an immediate pass, rate-limited to 0.5 s per team.
// Budget: OBJ_PERF ≤ 0.25 ms/tick amortised (AC-46).
//
// RNG: draws ONLY from sim.rng.obj (C26 — load-bearing: a shared stream
// would shift every downstream reaction and aim roll and make the AC-32
// bit-identity assertion impossible).

import * as LANTERNWALK from "../level/lanes/lanternwalk.js";
import * as STUB from "../level/lanes/_stub.js";
import { makeComms } from "./comms.js";
import { assign as assignTdm } from "./roles/tdm.js";
import { assign as assignCtf } from "./roles/ctf.js";
import { assign as assignFfa } from "./roles/ffa.js";

// ---------------------------------------------------------------- constants
export const OBJ_PERF = { calls: 0, totalMs: 0, avgMs: 0, lastMs: 0, maxMs: 0 };
// selftest lever (AC-32): when disableWrites is true the layer runs its full
// computation (same rng.obj consumption) but never writes bot._obj and never
// emits — the FSM then behaves byte-identically to a build with no layer.
export const OBJ_TEST = { disableWrites: false };

// the CLOSED reason vocabulary (bot_ai §11.8) — free text is banned; every
// objrole emission carries one of these and the selftest asserts membership.
export const REASONS = Object.freeze({
  DUTY: "DUTY", LANE_QUOTA: "LANE_QUOTA", LANE_PUSH: "LANE_PUSH",
  LANE_HOLD: "LANE_HOLD", LANE_ROTATE: "LANE_ROTATE", TRADE: "TRADE",
  COLLAPSE: "COLLAPSE", MATCH_POINT: "MATCH_POINT",
  POSTURE_PRESS: "POSTURE_PRESS", POSTURE_CONTROL: "POSTURE_CONTROL",
  RESPAWN_LEDGER: "RESPAWN_LEDGER",
  FLAG_TAKEN: "FLAG_TAKEN", FLAG_DROPPED: "FLAG_DROPPED",
  ATTACK_FLAG: "ATTACK_FLAG", DEFEND_STAND: "DEFEND_STAND",
  ESCORT_STATION: "ESCORT_STATION", CARRIER_NEEDS_ESCORT: "CARRIER_NEEDS_ESCORT",
  INTERCEPT: "INTERCEPT", CUTOFF_FEASIBLE: "CUTOFF_FEASIBLE",
  CUTOFF_INFEASIBLE: "CUTOFF_INFEASIBLE", RETURN_FLAG: "RETURN_FLAG",
  CARRY: "CARRY", HOLD_NEAR_STAND: "HOLD_NEAR_STAND", STALL_BREAKER: "STALL_BREAKER",
  LEASH: "LEASH", HUNT: "HUNT", EVADE: "EVADE", SURVIVE: "SURVIVE",
});

// Tier W, named once (Part 3.8 / AC-35): the facts this layer may read from
// match state, mirrored by the HUD. A fact not listed here is not read.
export const PUBLIC_FACTS = Object.freeze([
  "score", "clock", "phase", "killfeed", "flagState", "flagDroppedPos",
  "carrierBeacon3s6m", "leaderMark", "collapseRing", "ownTeamState",
]);

const PASS_PERIOD_TICKS = 30;      // 2 Hz commander cadence (bot_ai §2.4)
const EVENT_PASS_MIN_S = 0.5;      // event-driven rerun rate limit
const ROLE_LATCH_S = 4.0;          // §3.4 — a role latches ≥4 s
const ROUTE_LATCH_S = 5.0;         // §3.4 — a route re-picks ≤ once per 5 s
const LANE_LATCH_S = 8.0;          // §6.2 — lane assignment latch
const POSTURE_HOLD_S = 10.0;       // §3.1 hysteresis hold
const PRESS_AT = 0.45, HYST = 0.10;
const BEACON_REFRESH_S = 3.0;      // §4.3 — identical to the human's pip
const BEACON_QUANT_M = 6.0;
const WP_ARRIVE_M = 4.0;           // route waypoint advance radius
const WALK_MPS = 4.6, BLEND_MPS = 5.5;

// ---------------------------------------------------------------- helpers
export function hdist(a, b) { return Math.hypot(a[0] - b[0], a[2] - b[2]); }

export function quantBeacon(pos, q = BEACON_QUANT_M) {
  return [Math.round(pos[0] / q) * q, pos[1], Math.round(pos[2] / q) * q];
}

// ---------------------------------------------------------------- the graph
function buildGraph(mod) {
  const junctions = mod.junctions, lanes = mod.lanes, approaches = mod.approaches || {};
  const jNames = Object.keys(junctions);
  const byId = {};
  const adj = {};
  for (const j of jNames) adj[j] = [];
  for (const L of lanes) {
    byId[L.id] = L;
    let len = 0;
    for (let i = 1; i < L.wp.length; i++) len += hdist(L.wp[i - 1], L.wp[i]);
    L._len = Math.max(len, 1e-3);
    if (L.botTraversable === false) continue;
    if (L.throughGoing === false) continue; // an overlook is a post, not a route
    if (L.a === L.b) continue;
    adj[L.a].push({ lane: L, to: L.b, dir: 1 });
    adj[L.b].push({ lane: L, to: L.a, dir: -1 });
  }
  for (const j of jNames) adj[j].sort((x, y) => (x.lane.id < y.lane.id ? -1 : 1));
  return { junctions, lanes, approaches, jNames, byId, adj };
}

const GRAPHS = { lanternwalk: buildGraph(LANTERNWALK), _stub: buildGraph(STUB) };
export function laneGraphFor(arenaId) {
  return GRAPHS[arenaId] || GRAPHS._stub; // Part 4.2 — _stub fallback
}

export function nearestJunction(g, pos) {
  let best = null, bestD = Infinity;
  for (const j of g.jNames) {
    const d = hdist(g.junctions[j], pos);
    if (d < bestD) { bestD = d; best = j; }
  }
  return best;
}

export function nearestLane(g, pos) {
  let best = null, bestD = Infinity, bestI = 0;
  for (const L of g.lanes) {
    for (let i = 0; i < L.wp.length; i++) {
      const d = hdist(L.wp[i], pos);
      if (d < bestD) { bestD = d; best = L; bestI = i; }
    }
  }
  return best ? { lane: best, wpIndex: bestI, dist: bestD } : null;
}

// deterministic Dijkstra over junctions; costFn(lane) ≥ small positive.
export function junctionPath(g, fromJ, toJ, costFn) {
  if (fromJ === toJ) return { legs: [], cost: 0 };
  const dist = {}, prev = {};
  for (const j of g.jNames) dist[j] = Infinity;
  dist[fromJ] = 0;
  const open = new Set(g.jNames);
  while (open.size) {
    let u = null, du = Infinity;
    for (const j of g.jNames) { // jNames order → deterministic tie-break
      if (open.has(j) && dist[j] < du) { du = dist[j]; u = j; }
    }
    if (u == null || du === Infinity) break;
    open.delete(u);
    if (u === toJ) break;
    for (const e of g.adj[u]) {
      const c = du + (costFn ? costFn(e.lane) : e.lane._len);
      if (c < dist[e.to] - 1e-9) { dist[e.to] = c; prev[e.to] = { j: u, e }; }
    }
  }
  if (dist[toJ] === Infinity) return null;
  const legs = [];
  let cur = toJ;
  while (cur !== fromJ) {
    const p = prev[cur];
    if (!p) return null;
    legs.unshift(p.e);
    cur = p.j;
  }
  return { legs, cost: dist[toJ] };
}

// flatten a junction path into waypoints (lane wps in traversal order)
export function flattenLegs(legs) {
  const wps = [], laneIds = [];
  for (const e of legs) {
    const w = e.lane.wp;
    if (e.dir === 1) {
      for (let i = 0; i < w.length; i++) { wps.push(w[i]); laneIds.push(e.lane.id); }
    } else {
      for (let i = w.length - 1; i >= 0; i--) { wps.push(w[i]); laneIds.push(e.lane.id); }
    }
  }
  return { wps, laneIds };
}

// graph-approximate nav distance between two world points: euclid floor,
// junction-path estimate above it (bounded so far-apart nearest junctions
// cannot blow the estimate up on a sparse graph).
export function navDistApprox(g, a, b) {
  const e = hdist(a, b);
  if (e <= 10) return e;
  const ja = nearestJunction(g, a), jb = nearestJunction(g, b);
  if (!ja || !jb) return e;
  const p = junctionPath(g, ja, jb, null);
  if (!p) return e * 1.5;
  const through = hdist(a, g.junctions[ja]) + p.cost + hdist(g.junctions[jb], b);
  return Math.max(e, Math.min(through, e * 3));
}

// ---------------------------------------------------------------- per-sim state
function stateOf(sim) {
  let st = sim._w7;
  if (!st) {
    st = sim._w7 = {
      inited: false, comms: makeComms(), g: null, modeId: null,
      teams: new Map(),    // teamKey → commander record
      recs: new Map(),     // botId → bot record
      beacons: new Map(),  // flagId → {pos:[3], t}
      watch: { flagSig: "", scores: [], deaths: 0, deathRing: [] },
      scratch: { contacts: [], list: [] },
    };
  }
  return st;
}

function teamRec(st, key) {
  let r = st.teams.get(key);
  if (!r) {
    r = {
      posture: "balanced", postureAt: -1e9, pressure: 0,
      lastPassT: -1e9, eventDueT: -1, prevLedgerPress: false,
    };
    st.teams.set(key, r);
  }
  return r;
}

function botRec(st, bot, t) {
  let r = st.recs.get(bot.id);
  if (!r) {
    r = {
      who: bot.id, role: null, reason: null, assignedT: -1e9, holdUntil: -1e9,
      laneLatchId: null, laneLatchUntil: -1e9,
      route: null, routeAt: -1e9,
      progD: Infinity, progT: t, stallUntil: -1e9,
      lastBarkT: -1e9,
      obj: {
        role: null, reason: null, assignedT: 0, holdUntil: 0,
        anchor: null, anchorKind: null, route: null,
        priority: 0, firePolicy: "free", selfDefenseM: 12,
        posture: "balanced", breakFight: false,
        noRetreat: false, noFlank: false, noGrenade: false,
      },
      objRoute: { laneId: null, wpIndex: 0, dir: 1 },
    };
    st.recs.set(bot.id, r);
  }
  return r;
}

// ---------------------------------------------------------------- writeObj
function writeObj(sim, st, rec, bot, t, f) {
  rec.role = f.role;
  rec.reason = f.reason;
  const o = rec.obj;
  const changed = o.role !== f.role || o.reason !== f.reason;
  o.role = f.role;
  o.reason = f.reason;
  if (changed || f.rearm) { o.assignedT = t; rec.assignedT = t; }
  o.holdUntil = t + (f.holdS != null ? f.holdS : ROLE_LATCH_S);
  rec.holdUntil = o.holdUntil;
  o.anchor = f.anchor || null;
  o.anchorKind = f.anchorKind || (f.anchor ? "freeform" : null);
  o.route = f.routeLeg || null;
  o.priority = f.priority != null ? f.priority : 0;
  o.firePolicy = f.firePolicy || "free";
  o.selfDefenseM = f.selfDefenseM != null ? f.selfDefenseM : 12;
  o.posture = f.posture || "balanced";
  o.breakFight = !!f.breakFight;
  o.noRetreat = !!f.noRetreat;
  o.noFlank = !!f.noFlank;
  o.noGrenade = !!f.noGrenade;
  if (OBJ_TEST.disableWrites) return;
  bot._obj = o;
  if (changed) sim.emit("objrole", { botId: bot.id, role: f.role, reason: f.reason, t });
}

// bot_ai §7.9 NEVER tier: do not order a break that turns a bot's back on a
// live close threat. All reads are the bot's OWN percept.
function neverBreak(bot, t) {
  const P = bot.percept;
  if (bot.state === "retreat") return true;
  if (bot.lastHitT != null && t - bot.lastHitT <= 1.0 &&
      P && P.target != null && P.lastHitWho === P.target) return true;
  if (P && P.seesTarget && t - P.lastSeenT <= 0.3 && P.lastKnown &&
      hdist(bot.pos, P.lastKnown) <= 8) return true;
  return false;
}

// is the bot currently in a live engagement (its own knowledge only)?
function engagedNow(bot, t) {
  const P = bot.percept;
  return !!(P && P.target != null && (P.seesTarget || t - P.lastSeenT < 3.0));
}

// ---------------------------------------------------------------- routes
function routeCostFn(st, gid, team, bots, weaponBand) {
  const comms = st.comms;
  return (L) => {
    let mult = 1 + 1.6 * (L.exposure || 0.5);
    const midI = L.wp[Math.floor(L.wp.length / 2)];
    const cw = comms.contactWeightNear(gid, st._t, midI[0], midI[2], 10);
    mult += 2.2 * Math.min(2, cw) * 0.4;
    let friendly = 0;
    for (const fb of bots) {
      if (!fb.body) continue;
      if (hdist(fb.body.pos, midI) <= 12) friendly++;
    }
    mult /= 1 + 0.25 * Math.min(2, friendly);
    if (weaponBand && L.band) {
      const overlap = Math.min(weaponBand[1], L.band[1]) - Math.max(weaponBand[0], L.band[0]);
      if (overlap > 0) mult *= 0.85;
    }
    return L._len * mult;
  };
}

function buildRoute(st, g, fromPos, toPos, costFn) {
  const ja = nearestJunction(g, fromPos), jb = nearestJunction(g, toPos);
  if (!ja || !jb) return null;
  const p = junctionPath(g, ja, jb, costFn);
  if (!p) return null;
  const flat = flattenLegs(p.legs);
  flat.wps.push(toPos);
  flat.laneIds.push(flat.laneIds.length ? flat.laneIds[flat.laneIds.length - 1] : null);
  return { wps: flat.wps, laneIds: flat.laneIds, i: 0, key: ja + ">" + jb, to: toPos };
}

// advance the route pointer and return the current anchor waypoint.
function followRoute(rec, bot) {
  const r = rec.route;
  if (!r || !r.wps.length) return null;
  while (r.i < r.wps.length - 1 && hdist(bot.pos, r.wps[r.i]) <= WP_ARRIVE_M) r.i++;
  rec.objRoute.laneId = r.laneIds[r.i] || null;
  rec.objRoute.wpIndex = r.i;
  rec.objRoute.dir = 1;
  return r.wps[r.i];
}

// ---------------------------------------------------------------- situation
function situationOf(m, team, modeId) {
  const M = m.state;
  const rules = m.rules || {};
  const limit = modeId === "ctf" ? (rules.captureLimit || 3) : (rules.scoreLimit || 50);
  let us = 0, them = 0;
  if (modeId === "ffa") {
    // per-actor: `team` is the actor's own team id; `them` = best other
    for (const tt of M.teams) {
      if (tt.id === team) us = tt.score;
      else if (tt.score > them) them = tt.score;
    }
  } else {
    for (const tt of M.teams) {
      if (tt.id === team) us = tt.score; else them = tt.score;
    }
  }
  const timeLimit = rules.timeLimitS || 480;
  const elapsed = M.elapsed || 0;
  const progress = limit > 0 ? Math.max(us, them) / limit : 0;
  const timeFrac = timeLimit > 0 ? Math.min(1, elapsed / timeLimit) : 0;
  const urgency = Math.max(progress, timeFrac);
  const K = modeId === "ctf" ? 1 : (modeId === "ffa" ? 6 : 8);
  const pressure = Math.max(-1, Math.min(1, -(us - them) / K)) * urgency;
  return { us, them, limit, elapsed, timeLimit, timeFrac, urgency, pressure };
}

function postureOf(st, team, sit, t) {
  const tr = teamRec(st, team);
  tr.pressure = sit.pressure;
  const held = t - tr.postureAt < POSTURE_HOLD_S;
  let want = tr.posture;
  if (sit.pressure > PRESS_AT + (tr.posture === "press" ? -HYST : 0)) want = "press";
  else if (sit.pressure < -PRESS_AT + (tr.posture === "control" ? HYST : 0)) want = "control";
  else if (Math.abs(sit.pressure) < PRESS_AT - HYST) want = "balanced";
  if (want !== tr.posture && !held) { tr.posture = want; tr.postureAt = t; }
  return tr.posture;
}

// respawn ledger (bot_ai §3.3): enemyLive from public liveness. ≤2 → PRESS.
function enemyLiveCount(m, team) {
  let n = 0;
  for (const a of m.actors) if (a.alive && a.team !== team) n++;
  return n;
}

// ---------------------------------------------------------------- harvest
// Tier P → Tier R: each bot's own percept lastKnowns become team contacts.
function harvestContacts(st, gid, bots, t) {
  for (const fb of bots) {
    const P = fb.body && fb.body.percept;
    if (!P || !P.byTarget) continue;
    for (const who in P.byTarget) {
      const rec = P.byTarget[who];
      if (!rec || !rec.lastKnown) continue;
      const lt = Math.max(rec.lastSeenT != null ? rec.lastSeenT : -1e9,
        rec.lastHeardT != null ? rec.lastHeardT : -1e9);
      if (lt < 0 || t - lt > 8.0) continue;
      st.comms.noteContact(gid, who, rec.lastKnown, lt);
    }
  }
}

// ---------------------------------------------------------------- beacons
// Tier W: the carried-flag beacon — a {pos, t} sample refreshed every 3.0 s,
// quantised to the 6 m grid. Identical to the human's compass pip; between
// samples the carrier genuinely disappears, for bots and human alike.
function updateBeacons(st, m, t) {
  const flags = m.state.flags;
  if (!flags || !flags.length) return;
  const rules = m.rules || {};
  const bc = (rules.flag && rules.flag.beacon) || null;
  const refresh = bc && bc.refreshS != null ? bc.refreshS : BEACON_REFRESH_S;
  const quant = bc && bc.quantM != null ? bc.quantM : BEACON_QUANT_M;
  for (const f of flags) {
    const state = String(f.state || "").toUpperCase();
    if (state !== "CARRIED" && state !== "TAKEN") { st.beacons.delete(f.id); continue; }
    const b = st.beacons.get(f.id);
    if (b && t - b.t < refresh) continue;
    if (!f.pos) continue;
    st.beacons.set(f.id, { pos: quantBeacon(f.pos, quant), t });
  }
}

// ---------------------------------------------------------------- watch
function flagSig(m) {
  const flags = m.state.flags;
  if (!flags || !flags.length) return "";
  let s = "";
  for (const f of flags) s += f.id + ":" + f.state + ":" + (f.carrier != null ? f.carrier : "") + "|";
  return s;
}

// ---------------------------------------------------------------- the step
export function objectiveStep(sim, nav, squad, dt) {
  const M = sim.match;
  if (!M || !M.m || !sim.state.match) return; // campaign / probes: zero cost
  const m = M.m;
  const phase = m.phase;
  if (phase !== "live" && phase !== "overtime") return;
  // V9: the noTarget freeze lever also stands the commander down. It is the
  // C14 warm-up freeze and the scripted-scenario freeze (tdm.selftest poses
  // rule-edge matches under it, "scripted damage only") — a commander that
  // keeps marching bots into fights under the freeze defeats both uses.
  // Standing down clears every _obj so no stale order keeps feet moving.
  if (sim.flags && sim.flags.noTarget) {
    const st0 = sim._w7;
    if (st0 && !st0.stoodDown) {
      st0.stoodDown = true;
      // per-team home anchors: send everyone back where the pre-commander
      // idle would have kept them, not frozen mid-march
      const home = new Map();
      const clusters = m.clusters || {};
      for (const k of Object.keys(clusters).sort()) {
        const cl = clusters[k];
        if (cl && cl.anchor && cl.team != null && !home.has(cl.team)) home.set(cl.team, cl.anchor);
      }
      for (const b of sim.state.bots) {
        if (b._obj) b._obj = null;
        // the order also lives in the brain after H1/H4 copied it — unwind
        // the movement state (never the lethality state) so a frozen match
        // returns to the pre-commander idle, not a mid-map march
        const br = b._brain;
        if (br) {
          const anchor = (b.team != null && home.get(b.team)) || b.pos;
          br.anchor = anchor.slice();
          br.floorAnchor = br.anchor;
          br.anchorYaw = b.yaw;
          br.goal = br.anchor.slice(); br.path = null; br.pathI = 0;
          br.arrived = hdist(b.pos, br.anchor) < 1.0;
        }
      }
    }
    return;
  }
  if (sim._w7) sim._w7.stoodDown = false;

  const t0 = (globalThis.performance ? performance.now() : Date.now());
  const st = stateOf(sim);
  const t = sim.state.time;
  st._t = t;
  const modeId = sim.state.match.modeId;
  if (!st.inited) {
    st.inited = true;
    st.modeId = modeId;
    st.g = laneGraphFor(m.arena ? m.arena.id : "_stub");
    st.watch.scores = m.state.teams.map((x) => x.score);
    st.watch.flagSig = flagSig(m);
  }

  const tick = sim.state.tick;

  // ---- Tier-W watch → event-driven passes (rate-limited 0.5 s per team)
  let eventTeams = null;
  const sig = flagSig(m);
  if (sig !== st.watch.flagSig) {
    st.watch.flagSig = sig;
    eventTeams = "all";
  }
  {
    const teams = m.state.teams;
    for (let i = 0; i < teams.length; i++) {
      if (st.watch.scores[i] !== teams[i].score) {
        st.watch.scores[i] = teams[i].score;
        eventTeams = "all";
      }
    }
  }
  {
    let deaths = 0;
    for (const a of m.actors) deaths += a.deaths;
    if (deaths !== st.watch.deaths) {
      st.watch.deaths = deaths;
      // record death positions for the give-up-the-lane rule (public killfeed)
      for (const a of m.actors) {
        if (!a.alive && a._lastPos) {
          const ring = st.watch.deathRing;
          let seen = false;
          for (const d of ring) if (d.actorId === a.actorId && t - d.t < 0.5) seen = true;
          if (!seen) {
            ring.push({ actorId: a.actorId, team: a.team, pos: a._lastPos.slice(), t });
            if (ring.length > 12) ring.shift();
          }
        }
      }
      eventTeams = "all";
    }
  }

  // ---- which commander passes run this tick?
  const passes = [];
  if (modeId === "ffa") {
    if (tick % PASS_PERIOD_TICKS === 0) passes.push("ffa");
    else if (eventTeams) {
      const tr = teamRec(st, "ffa");
      if (t - tr.lastPassT >= EVENT_PASS_MIN_S) passes.push("ffa");
    }
  } else {
    for (let team = 0; team < 2; team++) {
      const slot = team === 0 ? 0 : 15;
      const tr = teamRec(st, team);
      if (tick % PASS_PERIOD_TICKS === slot) passes.push(team);
      else if (eventTeams && t - tr.lastPassT >= EVENT_PASS_MIN_S) passes.push(team);
    }
  }

  // ---- beacons (Tier W) — refreshed at the 3 s cadence, before any pass
  if (passes.length || eventTeams || tick % 15 === 7) updateBeacons(st, m, t);

  if (passes.length) {
    OBJ_PERF._inStep = true; // rng-attribution window (selftest instrument)
    // prune records of reaped bodies (respawn = new botId — C28 for free)
    const liveIds = new Set();
    for (const b of sim.state.bots) if (b.alive) liveIds.add(b.id);
    for (const id of st.recs.keys()) if (!liveIds.has(id)) st.recs.delete(id);

    for (const pass of passes) {
      const tr = teamRec(st, pass);
      tr.lastPassT = t;
      runPass(sim, st, m, modeId, pass, t, !!eventTeams, squad);
    }
    OBJ_PERF._inStep = false;
  }

  const dtMs = (globalThis.performance ? performance.now() : Date.now()) - t0;
  OBJ_PERF.calls++;
  OBJ_PERF.lastMs = dtMs;
  OBJ_PERF.totalMs += dtMs;
  OBJ_PERF.avgMs = OBJ_PERF.totalMs / OBJ_PERF.calls;
  if (dtMs > OBJ_PERF.maxMs) OBJ_PERF.maxMs = dtMs;
}

// ---------------------------------------------------------------- one pass
function runPass(sim, st, m, modeId, pass, t, preempt, squad) {
  const g = st.g;
  const rng = (sim.rng && sim.rng.obj) || (() => 0.5);

  // living team bots with bodies, actorId order (deterministic)
  const bots = [];
  let human = null;
  const teamKey = modeId === "ffa" ? null : pass;
  for (const a of m.actors) {
    if (!a.alive) continue;
    if (modeId !== "ffa" && a.team !== teamKey) continue;
    if (a.kind === "human") { human = { actor: a, body: null }; continue; }
    const body = m.bodyOf(a);
    if (!body || !body.alive) continue;
    bots.push({ actor: a, body, rec: botRec(st, body, t) });
  }
  if (!bots.length) return;

  const gid = modeId === "ffa" ? null : "t" + teamKey;

  // Tier P → Tier R harvest (team modes only; FFA groups are solitary)
  if (gid) harvestContacts(st, gid, bots, t);

  const sit = modeId === "ffa" ? null : situationOf(m, teamKey, modeId);
  let posture = "balanced";
  const tr = teamRec(st, pass);
  if (sit) {
    posture = postureOf(st, teamKey, sit, t);
    // respawn ledger override (§3.3): ≤2 enemies alive → press the window
    const ledgerPress = enemyLiveCount(m, teamKey) <= 2;
    if (ledgerPress) posture = "press";
    tr.ledgerPress = ledgerPress;
  }

  const api = {
    REASONS, hdist, rng, preempt,
    graph: g,
    comms: st.comms, gid,
    beacons: st.beacons,
    deathRing: st.watch.deathRing,
    navDist: (a, b) => navDistApprox(g, a, b),
    nearestLane: (pos) => nearestLane(g, pos),
    nearestJunction: (pos) => nearestJunction(g, pos),
    junctionPos: (j) => g.junctions[j],
    junctionPath: (a, b, fn) => junctionPath(g, a, b, fn),
    flattenLegs,
    routeCost: (weaponBand) => routeCostFn(st, gid || "solo", teamKey, bots, weaponBand),
    buildRoute: (fromPos, toPos, costFn) => buildRoute(st, g, fromPos, toPos, costFn),
    followRoute,
    engagedNow: (bot) => engagedNow(bot, t),
    neverBreak: (bot) => neverBreak(bot, t),
    latched: (rec) => rec.role != null && t < rec.holdUntil,
    write: (rec, bot, f) => {
      if (rec.route && f.routeUse) {
        f.routeLeg = rec.objRoute;
      }
      writeObj(sim, st, rec, bot, t, f);
    },
    bark: (bot, kind) => {
      // honest barks only — squad's cooldowns still apply (combat_spec §5.10)
      if (squad && squad.requestBark && !OBJ_TEST.disableWrites) squad.requestBark(bot.id, kind);
    },
  };

  const ctx = {
    sim, m, st, g, t, modeId, team: teamKey, gid, bots, human, sit, posture,
    rules: m.rules || {}, api,
    latchS: { role: ROLE_LATCH_S, route: ROUTE_LATCH_S, lane: LANE_LATCH_S },
    speeds: { walk: WALK_MPS, blend: BLEND_MPS },
  };

  if (modeId === "ctf") assignCtf(ctx);
  else if (modeId === "ffa") assignFfa(ctx);
  else assignTdm(ctx);
}
