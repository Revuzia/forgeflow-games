// core/match/modes/tdm.js [W5] — MODE 1: TEAM DEATHMATCH ("SKIRMISH", 5v5).
// PVP_BUILD_PLAN Part 4.1 row W5 — implements modes.md Part 2 + 2.5,
// architecture.md 1.7 + 5.4, bot_ai.md Part 6 (duty layer only — lane/route
// choice is W7's), rulings C12 (50 kills / 8:00 / 4.0 s respawn / 1.5 s
// protect), C13 (overtime decided by FIRST DEATH; COLLAPSE ring arms at
// OT+60 s) and C15 (100/kill, 25/assist — the driver's base ledger, which
// this mode deliberately does not override).
//
// THREE-free, Node-runnable, deterministic, allocation-free after start()
// on the per-tick paths. Draws nothing from the wall clock and nothing
// from unseeded randomness. Registered by boot.js via createMode (and by
// the selftest harnesses the same way).
//
// HONESTY BOUNDARY (Part 3.7/3.8, doctrine §2): this mode writes
// actor.duty = {role, target, urgency, targetHint} from PUBLIC facts only —
// team scores, the clock, the killfeed (death positions), own-team living
// positions, and static arena data (cluster anchors, bounds, the COLLAPSE
// centre). It never reads a living enemy transform, hp, yaw or weapon.
// The duty roles are a CLOSED enum: attack | roam | defend | trade | collapse.
//
// Every engagement must end: score limit → time limit → overtime first
// death → COLLAPSE (kills a 100 HP actor outside the ring within ~15 s of
// arming) → damage tie-break at the OT cap → driver draw. The driver's
// watchdog above all of that is a bug detector, not a crutch (AC-2).

const DT = 1 / 60;

// C13 / modes.md §2.4 — COLLAPSE defaults; content.match.collapse overrides.
const COLLAPSE_DEFAULTS = {
  centre: [-5, 0, 0], // plaza centre — the arena's most-connected space
  r0: 12.0, r1: 6.0, shrinkS: 30.0,
  dps0: 5.0, dps1: 15.0, rampS: 20.0,
  armsAfterOtS: 60.0,
};

// modes.md §2.5 role targets are re-evaluated at 2 Hz but a role is LATCHED
// for at least this long before it may change (role thrash reads as
// indecision and re-paths a bot mid-route).
const ROLE_LATCH_S = 4.0;
const TRADE_WINDOW_S = 6.0;   // a teammate dying is public to their own team
const CONTACT_WINDOW_S = 6.0; // killfeed positions considered "where the fight is"
const PRESS_DEFICIT = 8;      // arch 5.4 — losing by ≥8 → press
const CONTROL_LEAD = 12;      // arch 5.4 — winning by ≥12 → hold what you have

const MAX_CONTACTS = 12;

export function createMode(ctx) {
  const content = ctx.content || {};
  const cc = Object.assign({}, COLLAPSE_DEFAULTS,
    (content.match && content.match.collapse) || {});

  // ---------------------------------------------------------------- state
  // Everything mode-local lives here; the public sub-state is written into
  // m.state.mode at start() (JSON-safe plain data only).
  const st = {
    prevPhase: "pre",
    otClock: 0,
    firstDeathTeam: -1,       // C13: the team that lost the first OT actor
    // damage ledgers for the §2.3 tie-break chain, tracked by hp-sampling
    // (the mode interface has no per-hit hook; regen only raises hp so
    // sampling drops is faithful; COLLAPSE damage is self-applied and
    // subtracted before attribution. Known small distortion: self-damage
    // from an actor's own grenade is attributed to the enemy team — the
    // tie-break is only reachable when nobody died for 3:00 of overtime,
    // and it is documented here rather than hidden).
    dmgReg: [0, 0],
    dmgOt: [0, 0],
    prevHp: new Float64Array(10),
    zoneApplied: new Float64Array(10),
    collapse: { armed: false, radius: 0, dps: 0, lastEmitR: -1 },
    // killfeed contact ring (public facts): fixed-slot circular buffer
    contacts: [],
    contactIx: 0,
    // duty layer — persistent per-actor duty objects, mutated in place
    duties: [],
    dutyAssignedT: new Float64Array(10),
    pub: null,                 // m.state.mode alias
  };
  for (let i = 0; i < MAX_CONTACTS; i++) st.contacts.push({ pos: [0, 0, 0], team: -1, t: -1e9 });
  for (let i = 0; i < 10; i++) {
    st.duties.push({ role: null, target: [0, 0, 0], urgency: 0, targetHint: null });
    st.dutyAssignedT[i] = -1e9;
  }

  // scratch (assignDuties runs at 2 Hz — reused, never reallocated)
  const scrTeamBots = [];
  const scrAnchors = [];      // [{id, pos}] built once at start
  const scrOwnAnchors = [[], []];   // per-team anchor index lists
  const scrEnemyCentroid = [[0, 0, 0], [0, 0, 0]];
  const scrCentroid = [0, 0, 0];
  let arenaCentre = [0, 0, 0];

  function pushContact(pos, team, t) {
    const c = st.contacts[st.contactIx];
    c.pos[0] = pos[0]; c.pos[1] = pos[1]; c.pos[2] = pos[2];
    c.team = team; c.t = t;
    st.contactIx = (st.contactIx + 1) % MAX_CONTACTS;
  }

  function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  // ---------------------------------------------------------------- helpers
  function buildAnchors(m) {
    scrAnchors.length = 0;
    scrOwnAnchors[0].length = 0; scrOwnAnchors[1].length = 0;
    const clusters = m.clusters || {};
    const keys = Object.keys(clusters).sort(); // deterministic order
    for (const k of keys) {
      const cl = clusters[k];
      if (!cl || !cl.anchor) continue;
      scrAnchors.push({ id: k, pos: cl.anchor });
    }
    // per-team home anchors: rules.homeClusters (content-authored) wins,
    // else cluster.team fields, else every anchor.
    const hc = m.rules.homeClusters || null;
    for (let team = 0; team < 2; team++) {
      const own = scrOwnAnchors[team];
      if (hc && hc[team]) {
        for (let i = 0; i < scrAnchors.length; i++) {
          if (hc[team].includes(scrAnchors[i].id)) own.push(i);
        }
      }
      if (!own.length) {
        for (let i = 0; i < scrAnchors.length; i++) {
          const cl = clusters[scrAnchors[i].id];
          if (cl && cl.team === team) own.push(i);
        }
      }
      if (!own.length) for (let i = 0; i < scrAnchors.length; i++) own.push(i);
    }
    // enemy-side anchor centroid per team (static fallback contact point)
    for (let team = 0; team < 2; team++) {
      const en = scrOwnAnchors[1 - team];
      const out = scrEnemyCentroid[team];
      out[0] = arenaCentre[0]; out[1] = 0; out[2] = arenaCentre[2];
      if (en.length) {
        let x = 0, z = 0;
        for (const ix of en) { x += scrAnchors[ix].pos[0]; z += scrAnchors[ix].pos[2]; }
        out[0] = x / en.length; out[2] = z / en.length;
      }
    }
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

  // ---------------------------------------------------------------- ticks
  function sampleDamage(m) {
    // attribute hp drops (minus zone damage we applied) to the enemy team
    const ledger = st.prevPhase === "overtime" ? st.dmgOt : st.dmgReg;
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      const b = m.bodyOf(a);
      if (!b) continue;
      const hp = b.hp;
      const drop = st.prevHp[i] - hp;
      if (drop > 0) {
        const dealt = Math.max(0, drop - st.zoneApplied[i]);
        if (dealt > 0 && (a.team === 0 || a.team === 1)) ledger[1 - a.team] += dealt;
      }
      st.zoneApplied[i] = 0;
      st.prevHp[i] = hp;
    }
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
    // damage outside the ring, every sim tick (modes.md §2.4) — attacker
    // null, src 'zone', so a ring death is a death, never a kill (§2.2)
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.alive) continue;
      const p = m.posOf(a);
      if (!p) continue;
      if (dist2d(p[0], p[2], cc.centre[0], cc.centre[2]) > c.radius) {
        const amt = c.dps * dt;
        st.zoneApplied[i] += amt;
        m.sim.damage(a.who, amt, "zone");
      }
    }
    // public sub-state for the HUD ring/line (W6 reads state.mode.collapse)
    const pub = st.pub.collapse;
    pub.armed = true;
    pub.radius = Math.round(c.radius * 100) / 100;
    pub.dps = Math.round(c.dps * 100) / 100;
  }

  // ---------------------------------------------------------------- duties
  function assignTeamDuties(m, team, t) {
    scrTeamBots.length = 0;
    const actors = m.actors;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a.alive && a.kind === "bot" && a.team === team) scrTeamBots.push(a);
    }
    if (!scrTeamBots.length) return;

    // COLLAPSE overrides every latch — the ring is the only objective left
    if (st.collapse.armed) {
      for (const a of scrTeamBots) {
        setDutyOf(m, a, "collapse", cc.centre[0], cc.centre[1], cc.centre[2], 1.0, t);
      }
      return;
    }

    // contact centroid: mean of killfeed positions in the window (public),
    // falling back to the static enemy-side anchor centroid — NEVER a
    // living enemy read.
    let cn = 0; scrCentroid[0] = 0; scrCentroid[2] = 0;
    let tradeX = 0, tradeZ = 0, tradeT = -1e9;
    for (const c of st.contacts) {
      if (t - c.t > CONTACT_WINDOW_S) continue;
      scrCentroid[0] += c.pos[0]; scrCentroid[2] += c.pos[2]; cn++;
      if (c.team === team && t - c.t <= TRADE_WINDOW_S && c.t > tradeT) {
        tradeT = c.t; tradeX = c.pos[0]; tradeZ = c.pos[2];
      }
    }
    const fx = cn ? scrCentroid[0] / cn : scrEnemyCentroid[team][0];
    const fz = cn ? scrCentroid[2] / cn : scrEnemyCentroid[team][2];

    const teams = m.state.teams;
    const diff = teams[team].score - teams[1 - team].score;
    const press = diff <= -PRESS_DEFICIT;
    const control = diff >= CONTROL_LEAD;
    const attackUrgency = press ? 0.6 : 0.35;

    // deterministic greedy fill over UNLATCHED bots (actorId order base,
    // nearest-first per role). Latched bots keep their role; an 'attack'
    // latch still tracks the moving centroid.
    let wantTrade = tradeT > -1e9 ? 1 : 0;
    let wantAttack = 2;
    let wantDefend = control ? 1 : 0;
    for (const a of scrTeamBots) {
      const d = st.duties[a.actorId];
      const latched = d.role !== null && t - st.dutyAssignedT[a.actorId] < ROLE_LATCH_S;
      if (!latched) continue;
      if (d.role === "trade") { if (wantTrade > 0) wantTrade--; else d.role = null; }
      else if (d.role === "attack") {
        if (wantAttack > 0) { wantAttack--; d.target[0] = fx; d.target[2] = fz; d.urgency = attackUrgency; }
        else d.role = null;
      } else if (d.role === "defend") { if (wantDefend > 0) wantDefend--; else d.role = null; }
      // 'roam' keeps its anchor; 'collapse' cannot be latched here
      if (d.role === "collapse") d.role = null;
    }

    const free = [];
    for (const a of scrTeamBots) {
      const d = st.duties[a.actorId];
      const latched = d.role !== null && t - st.dutyAssignedT[a.actorId] < ROLE_LATCH_S;
      if (!latched || d.role === null) free.push(a);
    }

    const takeNearest = (x, z) => {
      let best = -1, bestD = Infinity;
      for (let i = 0; i < free.length; i++) {
        const p = m.posOf(free[i]);
        const dd = p ? dist2d(p[0], p[2], x, z) : Infinity;
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best < 0) return null;
      return free.splice(best, 1)[0];
    };

    if (wantTrade > 0 && free.length) {
      const a = takeNearest(tradeX, tradeZ);
      if (a) setDutyOf(m, a, "trade", tradeX, 0, tradeZ, 0.8, t);
    }
    for (let k = 0; k < wantAttack && free.length; k++) {
      const a = takeNearest(fx, fz);
      if (a) setDutyOf(m, a, "attack", fx, 0, fz, attackUrgency, t);
    }
    if (wantDefend > 0 && free.length) {
      // hold the team's own side: the home anchor nearest the team's centre
      let cx = 0, cz = 0, n = 0;
      for (const a of scrTeamBots) { const p = m.posOf(a); if (p) { cx += p[0]; cz += p[2]; n++; } }
      if (n) { cx /= n; cz /= n; }
      let anch = null, bestD = Infinity;
      for (const ix of scrOwnAnchors[team]) {
        const ap = scrAnchors[ix].pos;
        const dd = dist2d(ap[0], ap[2], cx, cz);
        if (dd < bestD) { bestD = dd; anch = ap; }
      }
      const a = anch ? takeNearest(anch[0], anch[2]) : null;
      if (a && anch) setDutyOf(m, a, "defend", anch[0], anch[1], anch[2], 0.45, t);
    }
    // the rest roam — spread across cluster anchors: each picks the anchor
    // farthest from teammates AND from already-assigned roam targets (this
    // is what stops the whole team stacking one lane — arch 5.4).
    while (free.length) {
      const a = free.shift();
      let best = null, bestScore = -Infinity;
      for (const anch of scrAnchors) {
        let minD = Infinity;
        for (const mate of scrTeamBots) {
          if (mate === a) continue;
          const p = m.posOf(mate);
          if (p) minD = Math.min(minD, dist2d(p[0], p[2], anch.pos[0], anch.pos[2]));
        }
        for (const mate of scrTeamBots) {
          const d = st.duties[mate.actorId];
          if (mate !== a && d.role === "roam") {
            minD = Math.min(minD, dist2d(d.target[0], d.target[2], anch.pos[0], anch.pos[2]));
          }
        }
        if (minD === Infinity) minD = 0;
        if (minD > bestScore) { bestScore = minD; best = anch; }
      }
      if (best) setDutyOf(m, a, "roam", best.pos[0], best.pos[1], best.pos[2], 0.5, t);
      else setDutyOf(m, a, "roam", arenaCentre[0], 0, arenaCentre[2], 0.5, t);
    }
  }

  // ---------------------------------------------------------------- HUD
  const hud = {
    headline: "SKIRMISH",
    clockS: 0, us: 0, them: 0,
    objectives: [{ id: "tdm_score", label: "", state: "active" }],
    markers: [],
  };
  const collapseMarker = { id: "collapse", kind: "collapse", pos: cc.centre, radius: 0 };

  // ---------------------------------------------------------------- mode
  return {
    _st: st, // private — selftest introspection only (mirrors match.js _ms)
    id: "tdm",
    displayName: "SKIRMISH",
    teamCount: 2,
    // C12 — labelled ARITHMETIC, not measurement; AC-41 measures the median
    // and the NUMBER changes (in content.modes.tdm), never the design.
    defaults: { scoreLimit: 50, timeLimitS: 480, respawnS: 4.0, protectS: 1.5 },

    start(m) {
      arenaCentre = [0, 0, 0];
      if (m.arena && m.arena.bounds) {
        const B = m.arena.bounds;
        arenaCentre[0] = (B.min[0] + B.max[0]) / 2;
        arenaCentre[2] = (B.min[2] + B.max[2]) / 2;
      }
      buildAnchors(m);
      st.pub = m.state.mode;
      st.pub.collapse = {
        armed: false,
        centre: [cc.centre[0], cc.centre[1], cc.centre[2]],
        radius: 0, dps: 0,
      };
      const actors = m.actors;
      for (let i = 0; i < actors.length; i++) {
        const b = m.bodyOf(actors[i]);
        st.prevHp[i] = b ? b.hp : 0;
      }
    },

    tick(m, dt) {
      const ph = m.phase;
      // damage ledgers attribute against the phase the damage LANDED in;
      // sample before flipping prevPhase so the boundary tick is honest.
      sampleDamage(m);
      if (ph === "overtime") {
        if (st.prevPhase !== "overtime") st.otClock = 0;
        st.otClock += dt;
        collapseTick(m, dt);
      }
      st.prevPhase = ph;
    },

    end(m, outcome) {
      // nothing to tear down — collapse state stays readable for the debrief
    },

    onSpawn(m, ev) {
      const b = m.bodyOf(ev.actor);
      st.prevHp[ev.actor.actorId] = b ? b.hp : 0;
      st.zoneApplied[ev.actor.actorId] = 0;
    },

    onKill(m, ev) {
      // TEAM SCORE = kills (modes.md §1.5); assists never add to it.
      m.addTeamScore(ev.attacker.team, 1, "kill");
    },

    onDeath(m, ev) {
      // killfeed position is public — feeds trade + contact centroid.
      // Suicides and zone deaths land here too (attacker null) and award
      // the enemy team NOTHING (§2.2 — no onKill fires for them).
      if (ev.pos) pushContact(ev.pos, ev.actor.team, ev.t);
      // C13: the first actor death of overtime decides it — the team that
      // did NOT lose an actor wins. Latched here (deterministic applyDamage
      // call order resolves same-tick doubles), read in checkWin.
      if (m.phase === "overtime" && st.firstDeathTeam < 0) {
        st.firstDeathTeam = ev.actor.team;
      }
    },

    // C7: tdm never vetoes a spawn point beyond the shared V1–V6 ladder.
    spawnVeto() { return false; },

    // C15: the driver's base ledger (100/kill, 25/assist ≥40 dmg within
    // 5 s) IS the TDM ledger — no scoreForKill override, deliberately.

    assignDuties(m) {
      const t = m.time;
      assignTeamDuties(m, 0, t);
      assignTeamDuties(m, 1, t);
    },

    checkWin(m) {
      const teams = m.state.teams;
      const a = teams[0], b = teams[1];
      const lim = m.rules.scoreLimit;

      // §2.2 — score limit, with the same-tick double-cross ruled:
      // both at/over the limit and EQUAL → draw (a both-hit-the-limit tie
      // is a finished match, not an overtime); otherwise higher wins.
      if (a.score >= lim || b.score >= lim) {
        if (a.score === b.score) return { result: "draw", winnerTeam: null, reason: "score limit tie" };
        return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "score limit" };
      }

      if (m.phase === "live") {
        // the driver consults us once at 0:00: higher score wins, exact tie
        // → null → the driver enters overtime (modes.md §2.1).
        if (m.timeLeft <= 0 && a.score !== b.score) {
          return { result: "win", winnerTeam: a.score > b.score ? a.id : b.id, reason: "time" };
        }
        return null;
      }

      if (m.phase === "overtime") {
        // C13 — first death loses it for their team.
        if (st.firstDeathTeam >= 0) {
          return { result: "win", winnerTeam: 1 - st.firstDeathTeam, reason: "overtime first death" };
        }
        // §2.3 tie-break chain at the 3:00 cap (the tick before the driver
        // would call it a draw): (1) team damage dealt in OT, (2) team
        // damage dealt in regulation, (3) null → the driver's draw.
        if (m.timeLeft <= DT * 1.5) {
          const EPS = 1e-6;
          if (Math.abs(st.dmgOt[0] - st.dmgOt[1]) > EPS) {
            return { result: "win", winnerTeam: st.dmgOt[0] > st.dmgOt[1] ? 0 : 1, reason: "overtime tiebreak (overtime damage)" };
          }
          if (Math.abs(st.dmgReg[0] - st.dmgReg[1]) > EPS) {
            return { result: "win", winnerTeam: st.dmgReg[0] > st.dmgReg[1] ? 0 : 1, reason: "overtime tiebreak (regulation damage)" };
          }
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
      if (st.collapse.armed) {
        o.label = "COLLAPSE — MOVE TO THE PLAZA";
        o.state = "active";
        if (hud.markers.length === 0) hud.markers.push(collapseMarker);
        collapseMarker.radius = st.collapse.radius;
      } else if (m.phase === "overtime") {
        o.label = "OVERTIME — FIRST DEATH LOSES";
        o.state = "active";
      } else {
        o.label = "ELIMINATE — FIRST TO " + m.rules.scoreLimit;
        o.state = "active";
      }
      return hud;
    },
  };
}
