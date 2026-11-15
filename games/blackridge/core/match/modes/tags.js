// core/match/modes/tags.js [lane modes] — MODE 6: RECLAIM (tag collection, 5v5).
//
// Every operator who dies drops a TAG where they fell. Walk over an ENEMY's
// tag and you CONFIRM it: +1 to your team. Walk over a TEAMMATE's tag and you
// DENY it: nobody scores it. A tag nobody reaches EXPIRES after `tagTtlS`
// (30 s). Kills alone never move the team score — only confirms do. First to
// `scoreLimit` (40) confirms wins, else the higher score at the horn. A tie at
// the horn goes to overtime with the driver's shared rule (no respawns): the
// first team AHEAD (the next confirm) wins it, or the last team with anyone
// standing; at the overtime cap: kills, then denies, then the driver's draw.
//
// Any death drops a tag, including a fall or a self-inflicted grenade — the
// tag is the victim's, so the enemy can still confirm it.
//
// THREE-free, Node-runnable, deterministic (no rng, no wall clock). The tag
// list is bounded (maxTags, oldest expires first); a drop allocates one small
// record (deaths are rare by construction) and every other tick is
// allocation-free. Registered by boot.js via createMode.
//
// PUBLIC STATE (m.state.mode, JSON-safe): tags[] {id, team, pos, droppedT,
// expiresT, victim} — every live tag is visible in the world to everyone (the
// HUD draws them all), so the AI may read them too. confirms[2] / denies[2]
// team tallies.
//
// EVENT VOCABULARY (new, additive — reported in the lane report):
//   tag {state, id, team, pos, by, byWho, byTeam, victim, victimWho}
//     state: "dropped"   — a tag hit the floor (by = the killer, or null)
//            "confirmed" — an enemy collected it (team scores)
//            "denied"    — a teammate of the victim collected it
//            "expired"   — nobody reached it in time
// Team scores ride the driver's match:score (reason "confirm").

const DT = 1 / 60;

export const TAGS_DEFAULTS = Object.freeze({
  scoreLimit: 40, timeLimitS: 600, respawnS: 4.0, protectS: 1.5,
  tagTtlS: 30,          // a tag lies 30 s
  pickupR: 1.6,         // walk within 1.6 m (horizontal) …
  pickupDy: 2.2,        // … on the same floor
  maxTags: 24,          // bound: the oldest expires first
  armS: 0.35,           // a tag cannot be collected the tick it lands
});

export const TAGS_POINTS = Object.freeze({ kill: 100, assist: 25, confirm: 50, deny: 50 });

function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

export function createMode(ctx) {
  const content = ctx.content || {};
  const st = {
    cfg: Object.assign({}, TAGS_DEFAULTS, (content.modes && content.modes.tags) || {}),
    pts: null,
    tags: [],                 // public records (aliased into m.state.mode.tags)
    nextId: 1,
    confirms: [0, 0], denies: [0, 0], expired: 0, dropped: 0,
    pub: null,
  };

  function emitTag(m, state, tag, actor) {
    m.emit("tag", {
      state, id: tag.id, team: tag.team, pos: [tag.pos[0], tag.pos[1], tag.pos[2]],
      by: actor ? actor.actorId : null, byWho: actor ? actor.who : null, byTeam: actor ? actor.team : -1,
      victim: tag.victim, victimWho: tag.victimWho,
    });
  }

  function removeAt(m, i, state, actor) {
    const tag = st.tags[i];
    st.tags.splice(i, 1);
    emitTag(m, state, tag, actor);
  }

  function collect(m, i, a) {
    const tag = st.tags[i];
    if (a.team !== tag.team) {
      st.confirms[a.team]++;
      a.confirms = (a.confirms || 0) + 1;
      m.addTeamScore(a.team, 1, "confirm");
      m.addScore(a, st.pts.confirm, "confirm");
      removeAt(m, i, "confirmed", a);
    } else {
      st.denies[a.team]++;
      a.denies = (a.denies || 0) + 1;
      m.addScore(a, st.pts.deny, "deny");
      removeAt(m, i, "denied", a);
    }
    // working the objective gives up spawn protection (same rule as a flag touch)
    if (a.protectedUntilT >= 0 && m.time < a.protectedUntilT) m.cancelProtection(a);
  }

  const hud = {
    headline: "RECLAIM",
    clockS: 0, us: 0, them: 0,
    objectives: [{ id: "tags_score", label: "", state: "active" }],
    markers: [],
  };

  const mode = {
    _st: st,
    id: "tags",
    displayName: "RECLAIM",
    teamCount: 2,
    defaults: {
      scoreLimit: TAGS_DEFAULTS.scoreLimit, timeLimitS: TAGS_DEFAULTS.timeLimitS,
      respawnS: TAGS_DEFAULTS.respawnS, protectS: TAGS_DEFAULTS.protectS,
      tagTtlS: TAGS_DEFAULTS.tagTtlS,
    },

    start(m) {
      st.cfg = Object.assign({}, TAGS_DEFAULTS, m.rules || {});
      st.pts = Object.assign({}, TAGS_POINTS, (m.rules && m.rules.points) || {});
      st.tags.length = 0;
      st.pub = m.state.mode;
      st.pub.tags = st.tags;
      st.pub.confirms = st.confirms;
      st.pub.denies = st.denies;
      st.pub.tagTtlS = st.cfg.tagTtlS;
      for (const a of m.actors) { a.confirms = 0; a.denies = 0; }
    },

    tick(m) {
      const ph = m.phase;
      if (ph !== "live" && ph !== "overtime") return;
      const t = m.time;
      // expiry (oldest first — the list is in drop order)
      for (let i = st.tags.length - 1; i >= 0; i--) {
        if (t >= st.tags[i].expiresT) { st.expired++; removeAt(m, i, "expired", null); }
      }
      if (!st.tags.length) return;
      // collection: each tag goes to the first living operator on it, in
      // actor order (deterministic; the human is actor 0)
      const R = st.cfg.pickupR, DY = st.cfg.pickupDy;
      const actors = m.actors;
      for (let i = st.tags.length - 1; i >= 0; i--) {
        const tag = st.tags[i];
        if (t < tag.armedT) continue;
        for (let k = 0; k < actors.length; k++) {
          const a = actors[k];
          if (!a.alive || (a.team !== 0 && a.team !== 1)) continue;
          const p = m.posOf(a);
          if (!p) continue;
          if (d2(p[0], p[2], tag.pos[0], tag.pos[2]) > R) continue;
          if (Math.abs((p[1] || 0) - tag.pos[1]) > DY) continue;
          collect(m, i, a);
          break;
        }
      }
    },

    end() { /* tags freeze where they lie — the debrief reads the tallies */ },

    // every death drops the victim's tag where they fell
    onDeath(m, ev) {
      const v = ev.actor;
      if (!v || (v.team !== 0 && v.team !== 1) || m.phase === "ended" || m.phase === "warmup") return;
      const p = ev.pos || m.posOf(v) || [0, 0, 0];
      if (st.tags.length >= st.cfg.maxTags) { st.expired++; removeAt(m, 0, "expired", null); }
      const tag = {
        id: st.nextId++, team: v.team, pos: [p[0], p[1] || 0, p[2]],
        droppedT: ev.t, expiresT: ev.t + st.cfg.tagTtlS, armedT: ev.t + st.cfg.armS,
        victim: v.actorId, victimWho: v.who,
      };
      st.tags.push(tag);
      st.dropped++;
      emitTag(m, "dropped", tag, ev.attacker || null);
    },

    // C7: no spawn rule beyond the shared V1–V6 ladder (same as SKIRMISH).
    spawnVeto() { return false; },

    // the ledger: kill 100 / assist 25 personal (team score is confirms only)
    scoreForKill(m, kev) {
      const entries = [{ actor: kev.attacker, points: st.pts.kill, reason: "kill" }];
      for (const aid of kev.assists) entries.push({ actor: m.actors[aid], points: st.pts.assist, reason: "assist" });
      return entries;
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
        if (m.timeLeft <= DT * 1.5) {
          let k0 = 0, k1 = 0;
          for (const x of m.actors) { if (x.team === 0) k0 += x.kills; else if (x.team === 1) k1 += x.kills; }
          if (k0 !== k1) return { result: "win", winnerTeam: k0 > k1 ? 0 : 1, reason: "overtime (kills)" };
          if (st.denies[0] !== st.denies[1]) return { result: "win", winnerTeam: st.denies[0] > st.denies[1] ? 0 : 1, reason: "overtime (denies)" };
          return null;
        }
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
      o.label = m.phase === "overtime" ? "OVERTIME — NEXT CONFIRM WINS"
        : "COLLECT ENEMY TAGS — FIRST TO " + m.rules.scoreLimit;
      o.state = "active";
      return hud;
    },
  };
  return mode;
}
