// core/match/modes/hill.js [lane modes] — MODE 5: OUTPOST (rotating hill, 5v5).
//
// ONE hill is live at a time. It rotates through the arena's OUTPOST_HILLS
// list (4-5 measured sites, in order, wrapping) every `rotateS` (60 s) of live
// play; the NEXT site is published for the last `previewS` (10 s) so both
// teams can rotate early. A team that is ALONE inside the ring holds it and
// scores 1 point per full second held; both teams inside = CONTESTED, nobody
// scores (and the partial second is lost — the point timer restarts when the
// hill next goes clean). First to `scoreLimit` (250) wins, else the higher
// score at the horn. A tie at the horn goes to overtime with the driver's
// shared rule (no respawns): the first team AHEAD on score wins it, or the
// last team with anyone standing; at the overtime cap: hill-seconds held,
// then kills, then the driver's draw. (Same overtime shape as STRONGHOLD.)
//
// THREE-free, Node-runnable, deterministic (draws nothing — no rng at all),
// allocation-free on the per-tick path after start() except the rare
// rotation / hold-change events. Registered by boot.js via createMode.
//
// Site positions are arena DATA: core/level/maps/<arena>.js OUTPOST_HILLS
// (measured on the baked nav — see the comment there). content.modes.hill.
// hills[arenaId] overrides them; a fixture with neither gets four sites
// synthesised around the line between the two flag stands.
//
// PUBLIC STATE (m.state.mode, JSON-safe): zones[] — the live hill (and, in the
// preview window, the next one with preview:true), in the same shape the
// STRONGHOLD board uses so the minimap / zone visuals read both; hill {idx,
// next, name, timeLeftS, previewOn, holder, contested, sites[]}; held[2]
// (team hill-seconds). Every field is something the HUD shows the human.
// Per-team head counts inside the ring are NOT published.
//
// EVENT VOCABULARY (new, additive — reported in the lane report):
//   hill {state, idx, label, name, team, prevTeam, pos, next, nextPos, by[], byWho[]}
//     state: "active"    — a site went live (match start / rotation)
//            "preview"   — the next site is now published (last previewS)
//            "held"      — a team took sole control (was empty / contested / theirs)
//            "contested" — both teams inside (edge, rate-limited 3 s)
//            "cleared"   — the hill emptied (nobody holds it)
//            "hold"      — every 5 points of an unbroken hold (byWho = inside)
//            "objkill"   — a kill on / at the hill (byWho = the killer)
// Team scores ride the driver's match:score (reason "hill").

import { OUTPOST_HILLS as LANTERNWALK_HILLS } from "../../level/maps/lanternwalk.js";
import { OUTPOST_HILLS as SWITCHYARD_HILLS } from "../../level/maps/switchyard.js";
import { OUTPOST_HILLS as SALTMARKET_HILLS } from "../../level/maps/saltmarket.js";

const DT = 1 / 60;

export const HILL_TABLE = Object.freeze({
  lanternwalk: LANTERNWALK_HILLS,
  switchyard: SWITCHYARD_HILLS,
  saltmarket: SALTMARKET_HILLS,
});

export const HILL_DEFAULTS = Object.freeze({
  scoreLimit: 250, timeLimitS: 600, respawnS: 4.0, protectS: 1.5,
  rotateS: 60,        // each site is live for 60 s of play
  previewS: 10,       // the next site is shown for the last 10 s
  hillR: 4.0, hillDy: 2.5,
});

export const HILL_POINTS = Object.freeze({
  kill: 100, assist: 25,
  hold: 10,           // personal, per team point earned while you stand in it
  objKill: 50,        // a kill where killer or victim is on the hill (r + objR)
  objR: 3.0,
});

const CONTEST_EMIT_S = 3.0;
const HOLD_EMIT_EVERY = 5;           // a "hold" event per 5 unbroken points
const SPAWN_HILL_M = 16.0;           // never spawn this close to the live hill
const SPAWN_NEXT_M = 10.0;           // …nor this close to the previewed next one
const BIAS_NEAR_M = 22.0, BIAS_FAR_M = 60.0;

function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// Resolve the site list for an arena (header for the precedence).
export function hillsFor(content, arenaId, flags) {
  const cm = content && content.modes && content.modes.hill;
  if (cm && cm.hills && cm.hills[arenaId]) return cm.hills[arenaId];
  if (content && content.arena && Array.isArray(content.arena.hills) &&
      (!content.arena.id || content.arena.id === arenaId)) return content.arena.hills;
  if (HILL_TABLE[arenaId]) return HILL_TABLE[arenaId];
  const fl = flags || (content && content.flags) || [];
  const f0 = fl.find((f) => f.team === 0), f1 = fl.find((f) => f.team === 1);
  if (!f0 || !f1) return [];
  const dx = f1.home[0] - f0.home[0], dz = f1.home[2] - f0.home[2];
  const L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L;
  const at = (k, side) => [f0.home[0] + dx * k + px * side, 0, f0.home[2] + dz * k + pz * side];
  return [
    { id: "1", pos: at(0.5, 0), r: 4 }, { id: "2", pos: at(0.3, 8), r: 4 },
    { id: "3", pos: at(0.7, -8), r: 4 }, { id: "4", pos: at(0.5, 14), r: 4 },
  ];
}

export function createMode(ctx) {
  const content = ctx.content || {};

  const st = {
    cfg: Object.assign({}, HILL_DEFAULTS, (content.modes && content.modes.hill) || {}),
    pts: null,
    sites: [],                 // {id, name, pos, r}
    idx: 0, clock: 0,          // live site + seconds it has been live
    previewOn: false,
    holder: -1, contested: false,
    acc: [0, 0],               // seconds toward the next point, per team
    streak: 0,                 // points of the current unbroken hold
    held: [0, 0],              // team hill-seconds (debrief + tie-break)
    n: [0, 0], who: [[], []],
    lastContestEmitT: -1e9,
    prevPhase: "pre",
    zone: null, nextZone: null, // public zone records (reused)
    pub: null,
    teamSide: ["west", "east"],
    rotations: 0,
  };
  for (const t of content.teams || []) if ((t.id === 0 || t.id === 1) && t.side) st.teamSide[t.id] = t.side;

  function buildSites(list) {
    st.sites.length = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      st.sites.push({
        id: s.id || String(i + 1), name: s.name || ("SITE " + (i + 1)),
        pos: [s.pos[0], s.pos[1] || 0, s.pos[2]], r: s.r || st.cfg.hillR,
      });
    }
    const s0 = st.sites[0] || { id: "1", name: "SITE 1", pos: [0, 0, 0], r: st.cfg.hillR };
    st.zone = {
      id: "hill", label: s0.id, name: s0.name, pos: s0.pos.slice(), r: s0.r,
      owner: -1, capTeam: -1, prog: 1, contested: false, phase: "idle", side: -1, preview: false,
    };
    st.nextZone = {
      id: "hill_next", label: "", name: "", pos: [0, 0, 0], r: s0.r,
      owner: -1, capTeam: -1, prog: 0, contested: false, phase: "preview", side: -1, preview: true,
    };
  }
  // sites are known at FACTORY time (the initial spawn wave vetoes against
  // them before mode.start — facadeBeforeSpawn, as STRONGHOLD does)
  buildSites(hillsFor(content, (content.arena && content.arena.id) || "lanternwalk", content.flags));

  function nextIdx() { return st.sites.length ? (st.idx + 1) % st.sites.length : 0; }

  function syncZone() {
    const s = st.sites[st.idx], z = st.zone;
    if (!s) return;
    z.label = s.id; z.name = s.name; z.r = s.r;
    z.pos[0] = s.pos[0]; z.pos[1] = s.pos[1]; z.pos[2] = s.pos[2];
    const nx = st.sites[nextIdx()], nz = st.nextZone;
    nz.label = nx.id; nz.name = nx.name; nz.r = nx.r;
    nz.pos[0] = nx.pos[0]; nz.pos[1] = nx.pos[1]; nz.pos[2] = nx.pos[2];
  }

  function emitHill(m, state, team, prevTeam, actors) {
    const by = [], byWho = [];
    if (actors) for (const a of actors) { by.push(a.actorId); byWho.push(a.who); }
    const s = st.sites[st.idx], nx = st.sites[nextIdx()];
    m.emit("hill", {
      state, idx: st.idx, label: s.id, name: s.name, team, prevTeam,
      pos: [s.pos[0], s.pos[1], s.pos[2]],
      next: nx.id, nextName: nx.name, nextPos: [nx.pos[0], nx.pos[1], nx.pos[2]],
      by, byWho,
    });
  }

  function publish() {
    const p = st.pub;
    if (!p) return;
    const z = st.zone;
    z.owner = st.holder; z.contested = st.contested;
    z.phase = st.contested ? "contested" : st.holder >= 0 ? "held" : "idle";
    z.prog = Math.max(0, 1 - st.clock / st.cfg.rotateS); // the ring's timer arc
    // zones[]: the live hill, plus the next one inside the preview window
    p.zones.length = 1;
    p.zones[0] = z;
    if (st.previewOn) p.zones.push(st.nextZone);
    const h = p.hill;
    h.idx = st.idx; h.next = nextIdx();
    h.name = z.name; h.label = z.label;
    h.nextName = st.previewOn ? st.nextZone.name : "";
    h.timeLeftS = Math.max(0, st.cfg.rotateS - st.clock);
    h.previewOn = st.previewOn;
    h.holder = st.holder; h.contested = st.contested;
  }

  function rotate(m) {
    st.idx = nextIdx();
    st.clock = 0;
    st.previewOn = false;
    st.holder = -1; st.contested = false;
    st.acc[0] = 0; st.acc[1] = 0; st.streak = 0;
    st.rotations++;
    syncZone();
    emitHill(m, "active", -1, -1, null);
  }

  function countPresence(m) {
    const z = st.zone, dy = st.cfg.hillDy;
    st.n[0] = 0; st.n[1] = 0; st.who[0].length = 0; st.who[1].length = 0;
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.alive || (a.team !== 0 && a.team !== 1)) continue;
      const bp = m.posOf(a);
      if (!bp) continue;
      if (d2(bp[0], bp[2], z.pos[0], z.pos[2]) > z.r) continue;
      if (Math.abs((bp[1] || 0) - z.pos[1]) > dy) continue;
      st.n[a.team]++;
      st.who[a.team].push(a);
    }
  }

  function hillTick(m, dt) {
    countPresence(m);
    const n0 = st.n[0], n1 = st.n[1];
    const contested = n0 > 0 && n1 > 0;
    const holder = contested ? -1 : n0 > 0 ? 0 : n1 > 0 ? 1 : -1;
    // per-operator time on the hill (scoreboard TIME column)
    for (let T = 0; T < 2; T++) for (const a of st.who[T]) a.hillS = (a.hillS || 0) + dt;
    if (contested !== st.contested || holder !== st.holder) {
      const prev = st.holder;
      if (contested && !st.contested && m.time - st.lastContestEmitT >= CONTEST_EMIT_S) {
        st.lastContestEmitT = m.time;
        emitHill(m, "contested", -1, prev, null);
      } else if (holder >= 0 && holder !== prev) {
        emitHill(m, "held", holder, prev, st.who[holder]);
      } else if (holder < 0 && !contested && (prev >= 0 || st.contested)) {
        emitHill(m, "cleared", -1, prev, null);
      }
      st.contested = contested;
      st.holder = holder;
      st.acc[0] = 0; st.acc[1] = 0; st.streak = 0; // partial seconds are lost
    }
    if (holder < 0) return;
    // a spawn-protected operator holding the objective gives the protection up
    const t = m.time;
    for (const a of st.who[holder]) if (a.protectedUntilT >= 0 && t < a.protectedUntilT) m.cancelProtection(a);
    st.held[holder] += dt;
    st.acc[holder] += dt;
    while (st.acc[holder] >= 1 - 1e-9) {
      st.acc[holder] -= 1;
      m.addTeamScore(holder, 1, "hill");
      for (const a of st.who[holder]) m.addScore(a, st.pts.hold, "hill");
      st.streak++;
      if (st.streak % HOLD_EMIT_EVERY === 0) emitHill(m, "hold", holder, holder, st.who[holder]);
    }
  }

  function tieBreak(m, tag) {
    if (Math.abs(st.held[0] - st.held[1]) > 1e-6) {
      return { result: "win", winnerTeam: st.held[0] > st.held[1] ? 0 : 1, reason: tag + " (hill time)" };
    }
    let k0 = 0, k1 = 0;
    for (const a of m.actors) { if (a.team === 0) k0 += a.kills; else if (a.team === 1) k1 += a.kills; }
    if (k0 !== k1) return { result: "win", winnerTeam: k0 > k1 ? 0 : 1, reason: tag + " (kills)" };
    return null;
  }

  const hud = {
    headline: "OUTPOST",
    clockS: 0, us: 0, them: 0,
    objectives: [{ id: "hill_score", label: "", state: "active" }],
    markers: [],
  };
  const hillMarker = { id: "hill", kind: "hill", label: "", pos: [0, 0, 0], r: 4, owner: -1, contested: false, timeLeftS: 0 };
  const nextMarker = { id: "hill_next", kind: "hill_next", label: "", pos: [0, 0, 0], r: 4 };

  const mode = {
    _st: st,
    id: "hill",
    displayName: "OUTPOST",
    teamCount: 2,
    facadeBeforeSpawn: true,
    defaults: {
      scoreLimit: HILL_DEFAULTS.scoreLimit, timeLimitS: HILL_DEFAULTS.timeLimitS,
      respawnS: HILL_DEFAULTS.respawnS, protectS: HILL_DEFAULTS.protectS,
      rotateS: HILL_DEFAULTS.rotateS, previewS: HILL_DEFAULTS.previewS,
    },

    start(m) {
      if (!m.mode) m.mode = mode;
      st.cfg = Object.assign({}, HILL_DEFAULTS, m.rules || {});
      st.pts = Object.assign({}, HILL_POINTS, (m.rules && m.rules.points) || {});
      const arenaId = (m.arena && m.arena.id) || (content.arena && content.arena.id) || "lanternwalk";
      if (!st.sites.length) buildSites(hillsFor(content, arenaId, m.arena && m.arena.flags));
      st.idx = 0; st.clock = 0; st.previewOn = false;
      syncZone();
      st.pub = m.state.mode;
      st.pub.zones = [st.zone];
      st.pub.hill = { idx: 0, next: nextIdx(), name: "", label: "", nextName: "", timeLeftS: st.cfg.rotateS,
        previewOn: false, holder: -1, contested: false, rotateS: st.cfg.rotateS, previewS: st.cfg.previewS,
        sites: st.sites.map((s) => ({ id: s.id, name: s.name, pos: s.pos.slice(), r: s.r })) };
      st.pub.held = st.held;
      for (const a of m.actors) a.hillS = 0;
      publish();
    },

    tick(m, dt) {
      const ph = m.phase;
      if (ph === "live" && st.prevPhase !== "live" && st.prevPhase !== "overtime") {
        emitHill(m, "active", -1, -1, null); // the first site goes live with the horn
      }
      st.prevPhase = ph;
      if (ph !== "live" && ph !== "overtime") { publish(); return; }
      st.clock += dt;
      if (st.clock >= st.cfg.rotateS - 1e-9) rotate(m);
      else if (!st.previewOn && st.cfg.rotateS - st.clock <= st.cfg.previewS + 1e-9 && st.sites.length > 1) {
        st.previewOn = true;
        emitHill(m, "preview", -1, -1, null);
      }
      hillTick(m, dt);
      publish();
    },

    end() { /* the board freezes where it is — the debrief reads it */ },

    // OBJECTIVE KILL: killer or victim on the hill (r + objR). Stacks on the
    // base ledger (kill 100 / assist 25).
    scoreForKill(m, kev) {
      const A = kev.attacker;
      const entries = [{ actor: A, points: st.pts.kill, reason: "kill" }];
      for (const aid of kev.assists) entries.push({ actor: m.actors[aid], points: st.pts.assist, reason: "assist" });
      if (m.phase === "live" || m.phase === "overtime") {
        const z = st.zone, R = z.r + st.pts.objR;
        const ap = m.posOf(A);
        const onV = kev.pos && d2(kev.pos[0], kev.pos[2], z.pos[0], z.pos[2]) <= R;
        const onA = ap && d2(ap[0], ap[2], z.pos[0], z.pos[2]) <= R;
        if (onV || onA) {
          entries.push({ actor: A, points: st.pts.objKill, reason: "hill kill" });
          A.objKills = (A.objKills || 0) + 1;
          emitHill(m, "objkill", A.team, st.holder, [A]);
        }
      }
      return entries;
    },

    // V7 for OUTPOST: never within 16 m of the live hill (either team — a
    // spawn ON the objective is a free hold), never within 10 m of the
    // previewed next site.
    spawnVeto(m, actor, p) {
      const z = st.zone;
      if (d2(p.pos[0], p.pos[2], z.pos[0], z.pos[2]) < SPAWN_HILL_M) return true;
      if (st.previewOn) {
        const nz = st.nextZone;
        if (d2(p.pos[0], p.pos[2], nz.pos[0], nz.pos[2]) < SPAWN_NEXT_M) return true;
      }
      return false;
    },

    // 0..1: your own side of the map, at a fighting distance from the hill
    // (not on top of it, not across the map).
    spawnBias(m, actor, p) {
      const team = actor.team;
      const z = st.zone;
      const d = d2(p.pos[0], p.pos[2], z.pos[0], z.pos[2]);
      const near = 1 - Math.min(1, Math.max(0, (d - BIAS_NEAR_M) / (BIAS_FAR_M - BIAS_NEAR_M)));
      const cl = m.clusters && p.cluster ? m.clusters[p.cluster] : null;
      const side = cl && cl.side ? (cl.side === st.teamSide[team] ? 1 : cl.side === "mid" ? 0.5 : 0) : 0.5;
      return 0.5 * near + 0.5 * side;
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
        if (a.score !== b.score) {
          return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "overtime lead" };
        }
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
        : "HOLD THE OUTPOST — FIRST TO " + m.rules.scoreLimit;
      o.state = "active";
      hud.markers.length = 0;
      const z = st.zone;
      hillMarker.label = z.label; hillMarker.r = z.r;
      hillMarker.pos[0] = z.pos[0]; hillMarker.pos[1] = z.pos[1]; hillMarker.pos[2] = z.pos[2];
      hillMarker.owner = st.holder; hillMarker.contested = st.contested;
      hillMarker.timeLeftS = Math.max(0, st.cfg.rotateS - st.clock);
      hud.markers.push(hillMarker);
      if (st.previewOn) {
        const nz = st.nextZone;
        nextMarker.label = nz.label; nextMarker.r = nz.r;
        nextMarker.pos[0] = nz.pos[0]; nextMarker.pos[1] = nz.pos[1]; nextMarker.pos[2] = nz.pos[2];
        hud.markers.push(nextMarker);
      }
      return hud;
    },
  };
  return mode;
}
