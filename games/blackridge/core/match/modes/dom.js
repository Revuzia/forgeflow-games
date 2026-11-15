// core/match/modes/dom.js [lane dom] — MODE 4: STRONGHOLD (zone control, 5v5).
//
// Three capture zones, A (AMBER side) / B (centre) / C (SLATE side). A zone is
// taken by PRESENCE: stand in its ring with no enemy inside and the capture
// bar fills — faster with more operators, frozen while both teams are inside
// (contested). An ENEMY-held zone must first be neutralised (its colour
// drains to grey) and then captured. Every `scoreTickS` each team scores one
// point per zone it holds; first to `scoreLimit` wins, else the higher score
// at the horn. A tie at the horn goes to overtime: no respawns (the driver's
// shared overtime rule), and the first team AHEAD on score — or the last team
// with anyone standing — wins it. At the overtime cap: zones held, then
// captures, then kills; all equal → the driver's draw.
//
// THREE-free, Node-runnable, deterministic (no wall clock, no unseeded
// randomness — this mode draws nothing at all), allocation-free on the per-
// tick path after start() (events on zone transitions excepted — rare by
// construction). Registered by boot.js via createMode, exactly like tdm/ctf.
//
// Zone positions are arena DATA: core/level/maps/<arena>.js STRONGHOLD_ZONES
// (measured on the baked nav — see the comment there). content.modes.dom.zones
// [arenaId] or content.arena.zones override them; a fixture with neither gets
// three zones synthesised on the line between the two flag stands.
//
// PUBLIC STATE (m.state.mode, JSON-safe): zones[] {id, label, pos, r, owner,
// capTeam, prog, phase, contested, side} and score bookkeeping. Every field is
// something the HUD shows the human (zone colour, the capture bar, the
// CONTESTED flag) — the per-team head counts inside a zone are NOT published
// (the human sees "contested", never "3 of them"), so the AI cannot read them.
//
// EVENT VOCABULARY (additive, deliberate — reported in the lane report):
//   zonecap {zone, label, state, team, owner, prevOwner, by[], byWho[], pos}
//     state: "capturing"   — a team starts filling a zone it does not hold
//            "neutralised" — an enemy-held zone drained to neutral
//            "captured"    — a team took the zone
//            "contested"   — both teams inside (edge, rate-limited 3 s/zone)
//            "defended"    — a kill near a zone the killer's team holds
// No other new event; scores ride the driver's match:score.

import { STRONGHOLD_ZONES as LANTERNWALK_ZONES } from "../../level/maps/lanternwalk.js";
import { STRONGHOLD_ZONES as SWITCHYARD_ZONES } from "../../level/maps/switchyard.js";
import { STRONGHOLD_ZONES as SALTMARKET_ZONES } from "../../level/maps/saltmarket.js";

const DT = 1 / 60;

export const ZONE_TABLE = Object.freeze({
  lanternwalk: LANTERNWALK_ZONES,
  switchyard: SWITCHYARD_ZONES,
  saltmarket: SALTMARKET_ZONES,
});

// The rules, data-driven: content.modes.dom overrides any of these.
export const DOM_DEFAULTS = Object.freeze({
  scoreLimit: 200, timeLimitS: 600, respawnS: 4.0, protectS: 1.5,
  scoreTickS: 2.5,          // +1 per held zone every 2.5 s
  captureS: 10.0,           // neutral → yours, one operator
  neutraliseS: 5.0,         // enemy-held → neutral, one operator
  decayS: 20.0,             // an EMPTY zone's partial bar drains in 20 s
  zoneR: 4.0, zoneDy: 2.5,  // the ring (horizontal radius, vertical slab)
  // presence multiplier by operators inside (index = count, 4+ saturates)
  rates: [0, 1.0, 1.5, 1.8, 2.0],
});

export const DOM_POINTS = Object.freeze({
  capture: 150, neutralise: 75, defendKill: 50, defendR: 4.0, // + the zone r
  kill: 100, assist: 25,
});

const CONTEST_EMIT_S = 3.0;
const SPAWN_ENEMY_ZONE_M = 12.0;   // no spawn this close to an enemy-held / contested / threatened zone
const SPAWN_INSIDE_PAD_M = 2.0;    // no spawn inside (r + pad) of any zone you do not hold
const BIAS_NEAR_M = 12.0, BIAS_FAR_M = 50.0;
const FORWARD_SPAWN_M = 22.0;      // enemy-side ground is spawnable only this close to a zone you hold

function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

export function rateFor(n, rates) {
  if (n <= 0) return 0;
  const r = rates || DOM_DEFAULTS.rates;
  return r[Math.min(n, r.length - 1)];
}

// Resolve the zone list for an arena (see header for the precedence).
export function zonesFor(content, arenaId, flags) {
  const cm = content && content.modes && content.modes.dom;
  if (cm && cm.zones && cm.zones[arenaId]) return cm.zones[arenaId];
  if (content && content.arena && Array.isArray(content.arena.zones) &&
      (!content.arena.id || content.arena.id === arenaId)) return content.arena.zones;
  if (ZONE_TABLE[arenaId]) return ZONE_TABLE[arenaId];
  // fixture fallback: A/B/C at 25/50/75 % of the stand-to-stand line
  const fl = flags || (content && content.flags) || [];
  const f0 = fl.find((f) => f.team === 0), f1 = fl.find((f) => f.team === 1);
  if (!f0 || !f1) return [];
  const at = (k) => [f0.home[0] + (f1.home[0] - f0.home[0]) * k, 0, f0.home[2] + (f1.home[2] - f0.home[2]) * k];
  return [{ id: "A", pos: at(0.25), r: 4 }, { id: "B", pos: at(0.5), r: 4 }, { id: "C", pos: at(0.75), r: 4 }];
}

export function createMode(ctx) {
  const content = ctx.content || {};

  // ---------------------------------------------------------------- state
  const st = {
    cfg: null, pts: null,
    zones: [],                 // public records (aliased into m.state.mode.zones)
    priv: [],                  // {n:[2], lastContestEmitT, wasContested, capEmittedFor}
    scoreAcc: 0,
    scoreTicks: 0,
    zoneSeconds: [0, 0],       // team-seconds of zone ownership (debrief/tiebreak)
    caps: [0, 0], neutralised: [0, 0], defends: [0, 0],
    prevPhase: "pre",
    otStartScore: [0, 0],
    pub: null,
    teamSide: ["west", "east"],
  };

  function buildZones(list) {
    st.zones.length = 0; st.priv.length = 0;
    const r0 = (st.cfg && st.cfg.zoneR) || DOM_DEFAULTS.zoneR;
    for (let i = 0; i < list.length && i < 3; i++) {
      const z = list[i];
      const id = z.id || "ABC"[i];
      st.zones.push({
        id, label: id,
        pos: [z.pos[0], z.pos[1] || 0, z.pos[2]],
        r: z.r || r0,
        side: i === 0 ? 0 : i === list.length - 1 ? 1 : -1, // A near AMBER, C near SLATE
        owner: -1, capTeam: -1, prog: 0,
        phase: "idle",           // idle | capturing | neutralising | contested | held
        contested: false,
      });
      st.priv.push({ n: [0, 0], who: [[], []], lastContestEmitT: -1e9, startEmitTeam: -1 });
    }
  }

  for (const t of content.teams || []) if ((t.id === 0 || t.id === 1) && t.side) st.teamSide[t.id] = t.side;

  // zones are known at FACTORY time (the initial spawn wave runs before
  // mode.start and its veto must already see them — facadeBeforeSpawn)
  st.cfg = Object.assign({}, DOM_DEFAULTS, (content.modes && content.modes.dom) || {});
  buildZones(zonesFor(content, (content.arena && content.arena.id) || "lanternwalk", content.flags));

  // ---------------------------------------------------------------- helpers
  function emitZone(m, z, state, team, prevOwner, actors) {
    const by = [], byWho = [];
    if (actors) for (const a of actors) { by.push(a.actorId); byWho.push(a.who); }
    m.emit("zonecap", {
      zone: z.id, label: z.label, state, team,
      owner: z.owner, prevOwner, by, byWho,
      pos: [z.pos[0], z.pos[1], z.pos[2]],
    });
  }

  // count living operators per team inside each zone (deterministic actor order)
  function countPresence(m) {
    const actors = m.actors;
    const dy = st.cfg.zoneDy;
    for (let zi = 0; zi < st.zones.length; zi++) {
      const z = st.zones[zi], p = st.priv[zi];
      p.n[0] = 0; p.n[1] = 0; p.who[0].length = 0; p.who[1].length = 0;
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (!a.alive || (a.team !== 0 && a.team !== 1)) continue;
        const bp = m.posOf(a);
        if (!bp) continue;
        if (d2(bp[0], bp[2], z.pos[0], z.pos[2]) > z.r) continue;
        if (Math.abs((bp[1] || 0) - z.pos[1]) > dy) continue;
        p.n[a.team]++;
        p.who[a.team].push(a);
      }
    }
  }

  function zoneTick(m, z, p, dt) {
    const cfg = st.cfg;
    const n0 = p.n[0], n1 = p.n[1];
    const t = m.time;
    const wasContested = z.contested;
    z.contested = n0 > 0 && n1 > 0;
    if (z.contested) {
      z.phase = "contested";
      if (!wasContested && t - p.lastContestEmitT >= CONTEST_EMIT_S) {
        p.lastContestEmitT = t;
        emitZone(m, z, "contested", -1, z.owner, null);
      }
      return; // frozen
    }
    if (n0 === 0 && n1 === 0) {
      // empty: a partial bar drains back (nobody is holding the button)
      if (z.prog > 0) {
        z.prog = Math.max(0, z.prog - dt / cfg.decayS);
        if (z.prog === 0) z.capTeam = -1;
      }
      z.phase = z.owner >= 0 ? "held" : "idle";
      p.startEmitTeam = -1;
      return;
    }
    const T = n0 > 0 ? 0 : 1;
    const n = T === 0 ? n0 : n1;
    const mult = rateFor(n, cfg.rates);
    if (z.owner === T) {
      // the holders are home: any enemy progress is wiped at their rate
      if (z.prog > 0) {
        z.prog = Math.max(0, z.prog - mult * dt / cfg.neutraliseS);
        if (z.prog === 0) z.capTeam = -1;
      }
      z.phase = "held";
      p.startEmitTeam = -1;
      return;
    }
    // a different team's partial progress must drain first
    if (z.capTeam >= 0 && z.capTeam !== T && z.prog > 0) {
      const durS = z.owner >= 0 ? cfg.neutraliseS : cfg.captureS;
      z.prog = Math.max(0, z.prog - mult * dt / durS);
      z.phase = z.owner >= 0 ? "neutralising" : "capturing";
      if (z.prog === 0) z.capTeam = -1;
      return;
    }
    z.capTeam = T;
    const actors = p.who[T];
    // a spawn-protected operator working an objective gives the protection up
    // (same §1.3 rule a flag touch uses)
    for (const a of actors) if (a.protectedUntilT >= 0 && t < a.protectedUntilT) m.cancelProtection(a);
    if (p.startEmitTeam !== T && z.prog === 0) {
      p.startEmitTeam = T;
      emitZone(m, z, "capturing", T, z.owner, actors);
    }
    if (z.owner >= 0) {
      // NEUTRALISE first
      z.phase = "neutralising";
      z.prog += mult * dt / cfg.neutraliseS;
      if (z.prog >= 1) {
        const prev = z.owner;
        z.owner = -1;
        z.prog = 0;            // the capture bar starts over from neutral
        z.capTeam = T;
        st.neutralised[T]++;
        for (const a of actors) m.addScore(a, st.pts.neutralise, "neutralise");
        emitZone(m, z, "neutralised", T, prev, actors);
        p.startEmitTeam = T;   // the follow-on capture is the same push — no second "capturing"
      }
    } else {
      z.phase = "capturing";
      z.prog += mult * dt / cfg.captureS;
      if (z.prog >= 1) {
        const prev = z.owner;
        z.owner = T;
        z.prog = 0;
        z.capTeam = -1;
        z.phase = "held";
        st.caps[T]++;
        for (const a of actors) { a.captures = (a.captures || 0) + 1; m.addScore(a, st.pts.capture, "capture"); }
        const Tm = m.state.teams.find((x) => x.id === T);
        if (Tm) Tm.captures = st.caps[T];
        emitZone(m, z, "captured", T, prev, actors);
        p.startEmitTeam = -1;
      }
    }
  }

  function scoreTick(m, dt) {
    st.scoreAcc += dt;
    for (const z of st.zones) if (z.owner === 0 || z.owner === 1) st.zoneSeconds[z.owner] += dt;
    const tick = st.cfg.scoreTickS;
    while (st.scoreAcc >= tick - 1e-9) {
      st.scoreAcc -= tick;
      st.scoreTicks++;
      let h0 = 0, h1 = 0;
      for (const z of st.zones) { if (z.owner === 0) h0++; else if (z.owner === 1) h1++; }
      if (h0) m.addTeamScore(0, h0, "zone");
      if (h1) m.addTeamScore(1, h1, "zone");
    }
  }

  function held(team) { let n = 0; for (const z of st.zones) if (z.owner === team) n++; return n; }

  function tieBreak(m, tag) {
    const h0 = held(0), h1 = held(1);
    if (h0 !== h1) return { result: "win", winnerTeam: h0 > h1 ? 0 : 1, reason: tag + " (zones held)" };
    if (st.caps[0] !== st.caps[1]) return { result: "win", winnerTeam: st.caps[0] > st.caps[1] ? 0 : 1, reason: tag + " (captures)" };
    let k0 = 0, k1 = 0;
    for (const a of m.actors) { if (a.team === 0) k0 += a.kills; else if (a.team === 1) k1 += a.kills; }
    if (k0 !== k1) return { result: "win", winnerTeam: k0 > k1 ? 0 : 1, reason: tag + " (kills)" };
    return null;
  }

  // ---------------------------------------------------------------- HUD
  const hud = {
    headline: "STRONGHOLD",
    clockS: 0, us: 0, them: 0,
    objectives: [{ id: "dom_score", label: "", state: "active" }],
    markers: [],
  };
  const zoneMarkers = [];

  // ---------------------------------------------------------------- mode
  const mode = {
    _st: st, // private — selftest introspection only (mirrors tdm.js / ctf.js)
    id: "dom",
    displayName: "STRONGHOLD",
    teamCount: 2,
    facadeBeforeSpawn: true, // the zone spawn rules bind the initial wave too
    defaults: {
      scoreLimit: DOM_DEFAULTS.scoreLimit, timeLimitS: DOM_DEFAULTS.timeLimitS,
      respawnS: DOM_DEFAULTS.respawnS, protectS: DOM_DEFAULTS.protectS,
      scoreTickS: DOM_DEFAULTS.scoreTickS,
    },

    start(m) {
      if (!m.mode) m.mode = mode;
      st.cfg = Object.assign({}, DOM_DEFAULTS, m.rules || {});
      st.pts = Object.assign({}, DOM_POINTS, (m.rules && m.rules.points) || {});
      const arenaId = (m.arena && m.arena.id) || (content.arena && content.arena.id) || "lanternwalk";
      // re-resolve against the arena the driver actually built (fallback
      // arenas carry their own flags) — but only when the factory guess had
      // nothing, so the initial-wave veto and the live zones are the same.
      if (!st.zones.length) buildZones(zonesFor(content, arenaId, m.arena && m.arena.flags));
      st.pub = m.state.mode;
      st.pub.zones = st.zones;
      st.pub.scoreTickS = st.cfg.scoreTickS;
      st.pub.captureS = st.cfg.captureS;
      st.pub.neutraliseS = st.cfg.neutraliseS;
      st.pub.caps = st.caps;
      st.pub.zoneSeconds = st.zoneSeconds;
      for (const tm of m.state.teams) tm.captures = 0;
      zoneMarkers.length = 0;
      for (const z of st.zones) {
        zoneMarkers.push({ id: "zone_" + z.id, kind: "zone", label: z.label, pos: z.pos, r: z.r, owner: -1, capTeam: -1, prog: 0, contested: false });
      }
    },

    tick(m, dt) {
      const ph = m.phase;
      if (ph === "overtime" && st.prevPhase !== "overtime") {
        st.otStartScore[0] = m.state.teams[0].score;
        st.otStartScore[1] = m.state.teams[1].score;
      }
      st.prevPhase = ph;
      if (ph !== "live" && ph !== "overtime") return;
      countPresence(m);
      for (let i = 0; i < st.zones.length; i++) zoneTick(m, st.zones[i], st.priv[i], dt);
      scoreTick(m, dt);
    },

    end() { /* zones freeze where they are — the debrief reads them */ },

    // defend kill: the victim died in or near (r + defendR) a zone the
    // killer's team holds. Stacks on the base ledger (kill 100 / assist 25).
    scoreForKill(m, kev) {
      const A = kev.attacker;
      const entries = [{ actor: A, points: st.pts.kill, reason: "kill" }];
      for (const aid of kev.assists) entries.push({ actor: m.actors[aid], points: st.pts.assist, reason: "assist" });
      if (kev.pos) {
        for (const z of st.zones) {
          if (z.owner !== A.team) continue;
          if (d2(kev.pos[0], kev.pos[2], z.pos[0], z.pos[2]) > z.r + st.pts.defendR) continue;
          entries.push({ actor: A, points: st.pts.defendKill, reason: "defend" });
          A.defends = (A.defends || 0) + 1;
          st.defends[A.team]++;
          emitZone(m, z, "defended", A.team, z.owner, [A]);
          break;
        }
      }
      return entries;
    },

    // V7 for STRONGHOLD (C7 hook): never inside a zone you do not hold, never
    // within 12 m of a zone the enemy holds, is contesting, or is filling;
    // and the SIDE rule — a team spawns on its own half (cluster.side) unless
    // the point is forward ground for a zone it holds (within 22 m). Measured
    // without it: AMBER respawns landed in SLATE's SC_NORTH next to SLATE's
    // own spawners and died walking out (lanternwalk seed 1).
    spawnVeto(m, actor, p) {
      const team = actor.team;
      const cl = m.clusters && p.cluster ? m.clusters[p.cluster] : null;
      if (cl && cl.side && cl.side !== "mid" && cl.side !== st.teamSide[team]) {
        let forward = false;
        for (const z of st.zones) {
          if (z.owner === team && d2(p.pos[0], p.pos[2], z.pos[0], z.pos[2]) < FORWARD_SPAWN_M) { forward = true; break; }
        }
        if (!forward) return true;
      }
      for (const z of st.zones) {
        const d = d2(p.pos[0], p.pos[2], z.pos[0], z.pos[2]);
        if (z.owner !== team && d < z.r + SPAWN_INSIDE_PAD_M) return true;
        const hot = (z.owner >= 0 && z.owner !== team) || z.contested ||
          (z.capTeam >= 0 && z.capTeam !== team && z.prog > 0);
        if (hot && d < SPAWN_ENEMY_ZONE_M) return true;
      }
      return false;
    },

    // 0..1 preference: near a zone you hold (the CoD "spawn behind your
    // flags" read), else your own side of the map.
    spawnBias(m, actor, p) {
      const team = actor.team;
      let best = Infinity;
      for (const z of st.zones) {
        if (z.owner !== team) continue;
        const d = d2(p.pos[0], p.pos[2], z.pos[0], z.pos[2]);
        if (d < best) best = d;
      }
      const near = best === Infinity ? 0
        : 1 - Math.min(1, Math.max(0, (best - BIAS_NEAR_M) / (BIAS_FAR_M - BIAS_NEAR_M)));
      const cl = m.clusters && p.cluster ? m.clusters[p.cluster] : null;
      const side = cl && cl.side ? (cl.side === st.teamSide[team] ? 1 : cl.side === "mid" ? 0.5 : 0) : 0.5;
      return 0.6 * near + 0.4 * side;
    },

    checkWin(m) {
      const teams = m.state.teams;
      const a = teams[0], b = teams[1];
      const lim = m.rules.scoreLimit;
      if (a.score >= lim || b.score >= lim) {
        if (a.score === b.score) return { result: "draw", winnerTeam: null, reason: "score limit tie" };
        return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "score limit" };
      }
      if (m.phase === "live") {
        if (m.timeLeft <= 0 && a.score !== b.score) {
          return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "time" };
        }
        return null;
      }
      if (m.phase === "overtime") {
        // sudden death: the first team ahead on score takes it
        if (a.score !== b.score) {
          return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "overtime lead" };
        }
        // no respawns in overtime — a side with nobody standing loses
        let l0 = 0, l1 = 0;
        for (const x of m.actors) if (x.alive) { if (x.team === 0) l0++; else if (x.team === 1) l1++; }
        if (l0 === 0 && l1 > 0) return { result: "win", winnerTeam: 1, reason: "overtime elimination" };
        if (l1 === 0 && l0 > 0) return { result: "win", winnerTeam: 0, reason: "overtime elimination" };
        if (m.timeLeft <= DT * 1.5) return tieBreak(m, "overtime");
        return null;
      }
      return null;
    },

    hudModel(m) {
      const teams = m.state.teams;
      hud.clockS = m.timeLeft;
      hud.us = teams[0].score;
      hud.them = teams[1].score;
      const o = hud.objectives[0];
      o.label = m.phase === "overtime" ? "OVERTIME — NEXT POINT WINS"
        : "HOLD THE ZONES — FIRST TO " + m.rules.scoreLimit;
      o.state = "active";
      hud.markers.length = 0;
      for (let i = 0; i < zoneMarkers.length; i++) {
        const zm = zoneMarkers[i], z = st.zones[i];
        zm.owner = z.owner; zm.capTeam = z.capTeam; zm.prog = z.prog; zm.contested = z.contested;
        hud.markers.push(zm);
      }
      return hud;
    },
  };
  return mode;
}
