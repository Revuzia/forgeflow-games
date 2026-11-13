// core/match/modes/ffa.js [W9] — MODE 3: FREE-FOR-ALL (10 actors).
// PVP_BUILD_PLAN Part 4.1 row W9 — implements modes.md Part 4,
// architecture.md 1.7 + 4.6 + 5.4, bot_ai.md Part 8 (duty layer only —
// lane/route choice is W7's), rulings C8 (the FFA spawn path — W2's
// director routes on teamCount 'perActor' / id 'ffa'; this mode requests
// it by BEING that, and vetoes nothing beyond the shared ladder), C12
// (25 kills / 8:00 / 3.0 s respawn / 2.0 s protect), C13 (modes.md §4.5
// overtime in full: tied leaders only, first tied-leader kill wins, a
// tied leader's death eliminates them, last leader standing wins,
// COLLAPSE arms at OT+60 s with full damage and NO exemptions) and C15
// (100/kill, 25/assist, +150 marked-leader kill — the entries stack).
//
// FFA is TEN TEAMS OF ONE (Part 3.4): team === actorId, so areEnemies()
// serves unchanged, friendly fire is trivially "everyone", and there is
// no `if (ffa)` branch anywhere outside the spawn scorer.
//
// THREE-free, Node-runnable, deterministic, allocation-free after start()
// on the per-tick paths. Draws nothing from the wall clock and nothing
// from unseeded randomness. Registered by boot.js via createMode.
//
// HONESTY BOUNDARY (Part 3.8, doctrine §2) — TIGHTER THAN THE TEAM MODES,
// because in FFA there is NO team-radio channel (Tier R is absent — each
// commsGroup is one bot). The FFA HUD publishes (Tier W): scores, the
// clock, the killfeed NAMES, the COLLAPSE ring, and — when armed — the
// marked leader's identity AND position (the through-geometry chevron,
// §4.2: "everyone can see you"). It publishes NO death positions and no
// other actor's position (no teammate pips — there are no teammates).
// This mode's duty layer therefore uses ONLY: static arena data (cluster
// anchors, bounds, the COLLAPSE centre), each bot's OWN position, public
// scores/phase, and the marked leader's position while the mark is armed.
// It never reads another living actor's transform, hp, yaw or weapon, and
// unlike tdm.js it does NOT use killfeed death positions — those are
// team-radio facts and the radio does not exist here.
// The duty roles are a CLOSED enum: hunt_leader | roam | collapse.
//
// Every engagement must end: score limit (outright leader) → time limit
// (kills → fewer deaths → earliest to the final count) → overtime (first
// tied-leader kill / eliminations / last leader standing) → COLLAPSE
// (kills a 100 HP actor outside the ring within ~15 s of arming) → draw
// at the OT cap with the tie intact. The driver's watchdog above all of
// that is a bug detector, not a crutch (AC-2).

const DT = 1 / 60;

// C13 / modes.md §2.4 — COLLAPSE defaults; content.match.collapse overrides.
// §4.5: in FFA the ring runs FULL damage with NO exemptions.
const COLLAPSE_DEFAULTS = {
  centre: [-5, 0, 0], // plaza centre — the arena's most-connected space
  r0: 12.0, r1: 6.0, shrinkS: 30.0,
  dps0: 5.0, dps1: 15.0, rampS: 20.0,
  armsAfterOtS: 60.0,
};

// modes.md §2.5 pattern: roles re-evaluated at 2 Hz, latched ≥4 s (role
// thrash reads as indecision and re-paths a bot mid-route).
const ROLE_LATCH_S = 4.0;
const MAX_LEADER_HUNTERS = 2; // AC-28 (no dogpile) — the duty layer never
                              // sends more than 2 bots after one actor.

export function createMode(ctx) {
  const content = ctx.content || {};
  const cc = Object.assign({}, COLLAPSE_DEFAULTS,
    (content.match && content.match.collapse) || {});

  // ---------------------------------------------------------------- state
  const st = {
    prevPhase: "pre",
    otClock: 0,
    // §4.5 overtime machine. otTied is null until overtime begins, then the
    // array of still-eligible tied-leader actorIds. otWinner latches the
    // first tied leader to score a kill (checked in checkWin, so a tied
    // leader who kills a tied leader wins by the KILL, not by elimination).
    otTied: null,
    otWinner: -1,
    // §4.1 tie-break (3): the sim time each actor reached its current kill
    // count. Equal counts, earlier time wins. -1e9 = "no kills yet" (all
    // equal → the break falls through to overtime).
    lastKillT: new Float64Array(10).fill(-1e9),
    // §4.2 leader marker. markedId is the marked actor or -1; kills-based,
    // so it survives the marked actor's death (their lead did).
    markedId: -1,
    collapse: { armed: false, radius: 0, dps: 0, lastEmitR: -1 },
    // duty layer — persistent per-actor duty objects, mutated in place
    duties: [],
    dutyAssignedT: new Float64Array(10),
    pub: null, // m.state.mode alias
  };
  for (let i = 0; i < 10; i++) {
    st.duties.push({ role: null, target: [0, 0, 0], urgency: 0, targetHint: null });
    st.dutyAssignedT[i] = -1e9;
  }

  // scratch (assignDuties runs at 2 Hz — reused, never reallocated)
  const scrBots = [];
  const scrFree = [];
  const scrAnchors = [];      // [{id, pos}] built once at start
  const scrClaimed = [];      // anchor indices claimed by latched roamers
  let arenaCentre = [0, 0, 0];

  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  // ---------------------------------------------------------------- helpers
  function buildAnchors(m) {
    scrAnchors.length = 0;
    const clusters = m.clusters || {};
    const keys = Object.keys(clusters).sort(); // deterministic order
    for (const k of keys) {
      const cl = clusters[k];
      if (!cl || !cl.anchor) continue;
      scrAnchors.push({ id: k, pos: cl.anchor });
    }
  }

  // Leaderboard scan — kills only (the win metric, §1.5). Returns into the
  // shared scratch: max kills, its unique holder (or -1 on a tie), and the
  // second-best count. No allocation.
  const lb = { max: -1, holder: -1, count: 0, second: -1 };
  function scanLeaders(m) {
    lb.max = -1; lb.holder = -1; lb.count = 0; lb.second = -1;
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const k = actors[i].kills;
      if (k > lb.max) { lb.second = lb.max; lb.max = k; lb.holder = actors[i].actorId; lb.count = 1; }
      else if (k === lb.max) { lb.count++; lb.second = k; }
      else if (k > lb.second) { lb.second = k; }
    }
    if (lb.count !== 1) lb.holder = -1;
    if (lb.second < 0) lb.second = 0;
    return lb;
  }

  // §4.2 — armed when an OUTRIGHT leader reaches atScore kills or leads by
  // ≥ orLeadBy (whichever first); a tie disarms it the moment it forms.
  function leaderTick(m) {
    const lm = m.rules.leaderMark || { atScore: 15, orLeadBy: 5 };
    const L = scanLeaders(m);
    let marked = -1;
    if (L.holder >= 0 && L.max > 0 &&
        (L.max >= lm.atScore || L.max - L.second >= lm.orLeadBy)) {
      marked = L.holder;
    }
    if (marked !== st.markedId) {
      if (st.markedId >= 0) m.emit("leaderMark", { actorId: st.markedId, on: false });
      if (marked >= 0) m.emit("leaderMark", { actorId: marked, on: true });
      st.markedId = marked;
      const pub = st.pub.leader;
      pub.actorId = marked;
      pub.on = marked >= 0;
      pub.name = marked >= 0 ? m.actors[marked].name : "";
    }
    if (st.markedId >= 0) st.pub.leader.kills = m.actors[st.markedId].kills;
  }

  function collapseTick(m, dt) {
    const c = st.collapse;
    if (st.otClock < cc.armsAfterOtS) return;
    const tSinceArm = st.otClock - cc.armsAfterOtS;
    if (!c.armed) {
      c.armed = true;
      c.radius = cc.r0;
      c.dps = cc.dps0;
      c.lastEmitR = cc.r0;
      m.emit("collapse", { armed: true, radius: c.radius });
    }
    c.radius = cc.r1 + (cc.r0 - cc.r1) * Math.max(0, 1 - tSinceArm / cc.shrinkS);
    c.dps = cc.dps0 + (cc.dps1 - cc.dps0) * Math.min(1, tSinceArm / cc.rampS);
    if (Math.abs(c.radius - c.lastEmitR) >= 0.5) {
      c.lastEmitR = c.radius;
      m.emit("collapse", { armed: true, radius: c.radius });
    }
    // §4.5: full damage, NO exemptions — every living actor outside the
    // ring, tied leader or not. attacker null, src 'zone': a ring death is
    // a death, never a kill, and it ELIMINATES a tied leader (onDeath).
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.alive) continue;
      const p = m.posOf(a);
      if (!p) continue;
      if (dist2d(p[0], p[2], cc.centre[0], cc.centre[2]) > c.radius) {
        m.sim.damage(a.who, c.dps * dt, "zone");
      }
    }
    const pub = st.pub.collapse;
    pub.armed = true;
    pub.radius = Math.round(c.radius * 100) / 100;
    pub.dps = Math.round(c.dps * 100) / 100;
  }

  function setDutyOf(m, actor, role, tx, ty, tz, urgency, t) {
    const d = st.duties[actor.actorId];
    if (d.role !== role) st.dutyAssignedT[actor.actorId] = t;
    d.role = role;
    d.target[0] = tx; d.target[1] = ty; d.target[2] = tz;
    d.urgency = urgency;
    d.targetHint = null;
    if (actor.duty !== d) m.setDuty(actor, d);
  }

  // ---------------------------------------------------------------- HUD
  const hud = {
    headline: "FREE-FOR-ALL",
    clockS: 0, us: 0, them: 0,
    objectives: [{ id: "ffa_score", label: "", state: "active" }],
    markers: [],
  };
  const collapseMarker = { id: "collapse", kind: "collapse", pos: cc.centre, radius: 0 };
  const leaderMarker = { id: "leader", kind: "leader", actorId: -1, pos: [0, 0, 0] };

  // ---------------------------------------------------------------- mode
  return {
    _st: st, // private — selftest introspection only (mirrors tdm.js _st)
    id: "ffa",
    displayName: "FREE-FOR-ALL",
    teamCount: "perActor", // ten teams of one — this IS the request for the
                           // C8 FFA spawn path (spawns.js routes on it)
    // C12 — labelled ARITHMETIC, not measurement; AC-41 measures the median
    // and the NUMBER changes (in content.modes.ffa), never the design.
    defaults: {
      scoreLimit: 25, timeLimitS: 480, respawnS: 3.0, protectS: 2.0,
      leaderMark: { atScore: 15, orLeadBy: 5 },
    },

    start(m) {
      arenaCentre = [0, 0, 0];
      if (m.arena && m.arena.bounds) {
        const B = m.arena.bounds;
        arenaCentre[0] = (B.min[0] + B.max[0]) / 2;
        arenaCentre[2] = (B.min[2] + B.max[2]) / 2;
      }
      buildAnchors(m);
      st.pub = m.state.mode;
      st.pub.leader = { actorId: -1, on: false, name: "", kills: 0 };
      st.pub.collapse = {
        armed: false,
        centre: [cc.centre[0], cc.centre[1], cc.centre[2]],
        radius: 0, dps: 0,
      };
      st.pub.overtime = { tied: [] };
    },

    tick(m, dt) {
      const ph = m.phase;
      if (ph === "overtime") {
        if (st.prevPhase !== "overtime") {
          // §4.5 — the tie is frozen at entry: everyone holding the max
          // kill count is a tied leader; only they can win overtime.
          st.otClock = 0;
          scanLeaders(m);
          st.otTied = [];
          // alive only: a leader already dead at 0:00 can never respawn in
          // overtime (driver rule), so they enter pre-eliminated — otherwise
          // the tie could never shrink past them and OT would always cap out.
          for (const a of m.actors) if (a.kills === lb.max && a.alive) st.otTied.push(a.actorId);
          st.pub.overtime.tied = st.otTied.slice();
        }
        st.otClock += dt;
        collapseTick(m, dt);
      }
      if (ph === "live" || ph === "overtime") leaderTick(m);
      st.prevPhase = ph;
    },

    end(m, outcome) {
      // nothing to tear down — leader/collapse state stays readable for the
      // debrief scoreboard
    },

    onSpawn(m, ev) {
      // no per-life ledgers — FFA's tie-breaks are kills/deaths/time, never
      // damage (§4.1), so unlike tdm there is nothing to sample here
    },

    onKill(m, ev) {
      const att = ev.attacker;
      // MATCH SCORE = kills, per actor-team (team === actorId), so
      // state.teams[i].score mirrors actors[i].kills and AC-3's
      // winner-consistency check reads the same truth either way.
      m.addTeamScore(att.team, 1, "kill");
      st.lastKillT[att.actorId] = ev.t; // §4.1 tie-break (3)
      // §4.5 — first STILL-TIED leader to score a kill wins overtime.
      if (m.phase === "overtime" && st.otTied &&
          st.otTied.indexOf(att.actorId) >= 0 && st.otWinner < 0) {
        st.otWinner = att.actorId;
      }
    },

    onDeath(m, ev) {
      // §4.5 — a tied leader who dies (to anyone, or to COLLAPSE) is
      // eliminated from the tie. Death POSITIONS are deliberately not
      // recorded: in FFA they are nobody's public fact (see header).
      if (m.phase === "overtime" && st.otTied) {
        const ix = st.otTied.indexOf(ev.actor.actorId);
        if (ix >= 0) {
          st.otTied.splice(ix, 1);
          st.pub.overtime.tied = st.otTied.slice();
        }
      }
    },

    // C7: ffa never vetoes a spawn point beyond the shared ladder (V1–V6 +
    // V10 live in the director, already actor-not-team in FFA).
    spawnVeto() { return false; },

    // C15 — the FFA ledger: kill 100, assist 25, marked-leader kill +150.
    // The entries STACK (modes.md's ledger ruling): a marked-leader kill
    // pays 100 (kill) + 150 (leader kill) = 250, plus any assists to
    // others. st.markedId still holds the pre-death mark here because
    // leaderTick runs in tick(), after the driver's death handling.
    scoreForKill(m, ev) {
      const out = [{ actor: ev.attacker, points: 100, reason: "kill" }];
      if (ev.victim.actorId === st.markedId) {
        out.push({ actor: ev.attacker, points: 150, reason: "leader kill" });
      }
      for (const aid of ev.assists) {
        out.push({ actor: m.actors[aid], points: 25, reason: "assist" });
      }
      return out;
    },

    assignDuties(m) {
      const t = m.time;
      scrBots.length = 0;
      const actors = m.actors;
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        if (a.alive && a.kind === "bot") scrBots.push(a);
      }
      if (!scrBots.length) return;

      // COLLAPSE overrides every latch — the ring is the only objective left
      if (st.collapse.armed) {
        for (const a of scrBots) {
          setDutyOf(m, a, "collapse", cc.centre[0], cc.centre[1], cc.centre[2], 1.0, t);
        }
        return;
      }

      // the marked leader's position is Tier W while the mark is armed
      // (§4.2 — the through-geometry chevron the human also sees). This is
      // the ONLY living-actor position this layer may read, ever.
      const marked = st.markedId >= 0 ? actors[st.markedId] : null;
      const markedPos = marked && marked.alive ? m.posOf(marked) : null;

      // pass 1 — latched bots keep their role; hunt_leader tracks the
      // moving chevron and releases the moment the mark disarms or dies.
      scrFree.length = 0;
      let hunters = 0;
      for (const a of scrBots) {
        const d = st.duties[a.actorId];
        let latched = d.role !== null && t - st.dutyAssignedT[a.actorId] < ROLE_LATCH_S;
        if (latched && d.role === "collapse") { d.role = null; latched = false; }
        if (latched && d.role === "hunt_leader") {
          if (markedPos && st.markedId !== a.actorId && hunters < MAX_LEADER_HUNTERS) {
            d.target[0] = markedPos[0]; d.target[1] = markedPos[1]; d.target[2] = markedPos[2];
            hunters++;
          } else { d.role = null; latched = false; }
        }
        if (!latched || d.role === null) scrFree.push(a);
      }

      // pass 2 — assign hunt_leader up to the AC-28 cap of 2, nearest by
      // each candidate's OWN position (own-pos + a public pos is a fact the
      // bot could compute for itself; no information is granted).
      while (markedPos && hunters < MAX_LEADER_HUNTERS && scrFree.length) {
        let best = -1, bestD = Infinity;
        for (let i = 0; i < scrFree.length; i++) {
          const a = scrFree[i];
          if (a.actorId === st.markedId) continue; // never hunt yourself
          const p = m.posOf(a);
          const dd = p ? dist2d(p[0], p[2], markedPos[0], markedPos[2]) : Infinity;
          if (dd < bestD) { bestD = dd; best = i; }
        }
        if (best < 0) break;
        const a = scrFree.splice(best, 1)[0];
        setDutyOf(m, a, "hunt_leader", markedPos[0], markedPos[1], markedPos[2], 0.7, t);
        hunters++;
      }

      // pass 3 — the rest roam across cluster anchors (STATIC data). Each
      // free bot takes an anchor no latched roamer already claims, farthest
      // from its OWN position (keeps bots crossing the map, which is what
      // finds fights on a 75%-LOS arena); claims are mode bookkeeping, not
      // world knowledge. Overtime roams harder: a tied leader needs a kill
      // and a non-leader is the kingmaker (§4.5) — both want contact.
      scrClaimed.length = 0;
      for (const a of scrBots) {
        const d = st.duties[a.actorId];
        if (d.role !== "roam" || scrFree.indexOf(a) >= 0) continue;
        for (let i = 0; i < scrAnchors.length; i++) {
          const ap = scrAnchors[i].pos;
          if (dist2d(ap[0], ap[2], d.target[0], d.target[2]) < 0.5) { scrClaimed.push(i); break; }
        }
      }
      const urgency = m.phase === "overtime" ? 0.8 : 0.5;
      while (scrFree.length) {
        const a = scrFree.shift();
        const p = m.posOf(a);
        let best = -1, bestD = -Infinity, bestFree = -1, bestFreeD = -Infinity;
        for (let i = 0; i < scrAnchors.length; i++) {
          const ap = scrAnchors[i].pos;
          const dd = p ? dist2d(p[0], p[2], ap[0], ap[2]) : 0;
          if (dd > bestD) { bestD = dd; best = i; }
          if (scrClaimed.indexOf(i) < 0 && dd > bestFreeD) { bestFreeD = dd; bestFree = i; }
        }
        const pick = bestFree >= 0 ? bestFree : best;
        if (pick >= 0) {
          const ap = scrAnchors[pick].pos;
          setDutyOf(m, a, "roam", ap[0], ap[1], ap[2], urgency, t);
          scrClaimed.push(pick);
        } else {
          setDutyOf(m, a, "roam", arenaCentre[0], 0, arenaCentre[2], urgency, t);
        }
      }
    },

    checkWin(m) {
      const lim = m.rules.scoreLimit;

      if (m.phase === "live") {
        const L = scanLeaders(m);
        // §4.1 — first to the limit, but "first" means OUTRIGHT: if two
        // actors cross the limit on the same tick with equal kills there is
        // no first, so play continues until one leads (terminates: the next
        // kill breaks it, and the clock backstops the pathological case).
        if (L.max >= lim && L.holder >= 0) {
          return { result: "win", winnerTeam: m.actors[L.holder].team, reason: "score limit" };
        }
        // §4.1 tie at 0:00 — (1) kills, (2) fewer deaths, (3) earliest sim
        // time the final count was reached, then null → the driver's OT.
        if (m.timeLeft <= 0) {
          if (L.holder >= 0) {
            return { result: "win", winnerTeam: m.actors[L.holder].team, reason: "time" };
          }
          let winner = -1, bestDeaths = Infinity, deathTie = false;
          for (const a of m.actors) {
            if (a.kills !== L.max) continue;
            if (a.deaths < bestDeaths) { bestDeaths = a.deaths; winner = a.actorId; deathTie = false; }
            else if (a.deaths === bestDeaths) deathTie = true;
          }
          if (!deathTie && winner >= 0) {
            return { result: "win", winnerTeam: m.actors[winner].team, reason: "time tiebreak (fewer deaths)" };
          }
          let early = -1, bestT = Infinity, tTie = false;
          for (const a of m.actors) {
            if (a.kills !== L.max || a.deaths !== bestDeaths) continue;
            const kt = st.lastKillT[a.actorId];
            if (kt < bestT) { bestT = kt; early = a.actorId; tTie = false; }
            else if (kt === bestT) tTie = true;
          }
          if (!tTie && early >= 0 && bestT > -1e8) {
            return { result: "win", winnerTeam: m.actors[early].team, reason: "time tiebreak (earliest to the score)" };
          }
          return null; // genuine tie → overtime
        }
        return null;
      }

      if (m.phase === "overtime") {
        if (!st.otTied) return null; // tie set builds in tick() this tick
        // §4.5, in priority order: a still-tied leader's kill wins outright…
        if (st.otWinner >= 0) {
          return { result: "win", winnerTeam: m.actors[st.otWinner].team, reason: "overtime kill" };
        }
        // …eliminations resolve it when one leader remains…
        if (st.otTied.length === 1) {
          return { result: "win", winnerTeam: m.actors[st.otTied[0]].team, reason: "overtime last leader" };
        }
        // …all tied leaders dead simultaneously → draw among the tied…
        if (st.otTied.length === 0) {
          return { result: "draw", winnerTeam: null, reason: "overtime leaders eliminated" };
        }
        // …cap reached with the tie intact → draw (the tick before the
        // driver's own cap draw, so the reason names the mechanism).
        if (m.timeLeft <= DT * 1.5) {
          return { result: "draw", winnerTeam: null, reason: "overtime cap (tie intact)" };
        }
        return null;
      }
      return null;
    },

    hudModel(m) {
      hud.clockS = m.timeLeft;
      // §7.4 score strip: YOU n · LEADER n — "them" is the best RIVAL count
      const you = m.actors[0];
      hud.us = you.kills;
      let rival = 0;
      for (const a of m.actors) if (a.actorId !== 0 && a.kills > rival) rival = a.kills;
      hud.them = rival;
      const o = hud.objectives[0];
      hud.markers.length = 0;
      if (st.collapse.armed) {
        o.label = "COLLAPSE — MOVE TO THE PLAZA";
        collapseMarker.radius = st.collapse.radius;
        hud.markers.push(collapseMarker);
      } else if (m.phase === "overtime") {
        o.label = "OVERTIME — TIED LEADERS: FIRST KILL WINS";
      } else if (st.markedId === 0) {
        o.label = "YOU ARE MARKED — FIRST TO " + m.rules.scoreLimit; // §7.4:
        // nobody is tracked silently
      } else {
        o.label = "FIRST TO " + m.rules.scoreLimit + " — EVERYONE IS HOSTILE";
      }
      o.state = "active";
      if (st.markedId >= 0) {
        const ml = m.actors[st.markedId];
        const p = ml.alive ? m.posOf(ml) : null;
        if (p) {
          leaderMarker.actorId = st.markedId;
          leaderMarker.pos[0] = p[0]; leaderMarker.pos[1] = p[1]; leaderMarker.pos[2] = p[2];
          hud.markers.push(leaderMarker);
        }
      }
      return hud;
    },
  };
}
