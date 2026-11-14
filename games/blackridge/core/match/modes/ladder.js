// core/match/modes/ladder.js [lane modes] — MODE 7: ASCENT (weapon ladder, FFA).
//
// Ten operators, everyone for themselves, everyone on the SAME weapon. Every
// kill moves you one rung up the ladder and swaps the gun in your hands on the
// spot; a kill on the LAST rung finishes the ladder and wins the match. The
// ladder runs through the five weapons with three attachment variants
// (LADDER_TIERS below, 8 rungs). When the melee VERB is present (the quick
// knife strike, core/sim/melee.js) a KNIFE rung is appended as the last one —
// the pistol is carried EMPTY and stays empty, so the knife is the only way
// to finish — and a KNIFE kill also knocks the victim DOWN one rung. Without
// the verb the ladder ends on the pistol and nobody is ever demoted.
//
// No classes, no ground loot, no racks, no call-ins, no lethal / tactical
// equipment in this mode: the mode sets `forcedLoadout`, and core/sim/sim.js
// switches those systems off for the sim it builds (see the [lane modes] hook
// there); every life starts on your current rung via sim.setLadderWeapon.
//
// TEAM SCORE = rungs climbed (team === actorId — ten teams of one, like FFA),
// so the score strip, the scoreboard and the AI all read ladder progress.
// At the horn: highest rung, then fewer deaths; a full tie goes to overtime
// with the FFA rule (no respawns; the tied leaders are frozen at entry, the
// first of them to make a kill wins, a tied leader who dies is out, the last
// one standing wins; cap with the tie intact → draw).
//
// THREE-free, Node-runnable, deterministic (no rng, no wall clock),
// allocation-free per tick after start(). Registered by boot.js.
//
// PUBLIC STATE (m.state.mode): tiers[] {weapon, attach, knife}, tier[10] (each
// operator's rung, public — the scoreboard shows it), leader {actorId, tier},
// melee (bool: the knife rung + demotion are live).
//
// EVENT VOCABULARY (new, additive — reported in the lane report):
//   ladder {state, actorId, who, tier, of, weapon, attach, by}
//     state: "promoted" — a kill moved `who` up to `tier` (0-based)
//            "demoted"  — a melee kill knocked `who` down (by = the killer)
//            "finished" — `who` made the kill on the last rung
//            "lead"     — `who` is the new outright leader

const DT = 1 / 60;

// The melee VERB (core/sim/melee.js — the quick knife strike every combatant
// has). Probed once at module init, like objective.js probes its lane graphs:
// present → the ladder ends on a KNIFE rung (the gun is carried empty) and a
// knife kill demotes; absent → the ladder ends on the pistol, no demotion.
let MELEE_VERB_ID = null;
try {
  const mm = await import("../../sim/melee.js");
  if (mm && mm.MELEE && typeof mm.tryBeginMelee === "function") MELEE_VERB_ID = mm.MELEE.WEAPON_ID || "knife";
} catch (e) { MELEE_VERB_ID = null; }
export function meleeVerbId() { return MELEE_VERB_ID; }

// The ladder (data). Attachment ids are gunsmith ids (core/sim/attachments.js).
export const LADDER_TIERS = Object.freeze([
  { weapon: "warden", attach: [] },
  { weapon: "warden", attach: ["holo", "compensator", "grip"] },
  { weapon: "vesper", attach: [] },
  { weapon: "vesper", attach: ["laser", "rapidfire"] },
  { weapon: "breaker", attach: [] },
  { weapon: "corvus", attach: [] },
  { weapon: "corvus", attach: ["reddot", "compensator"] },
  { weapon: "pike", attach: [] },
]);

export const LADDER_DEFAULTS = Object.freeze({ timeLimitS: 480, respawnS: 2.5, protectS: 2.0 });

// a kill made with the melee verb (death events carry weaponId "knife")
export function isMeleeKill(weaponId, verbId) {
  return !!weaponId && !!verbId && weaponId === verbId;
}

// The rungs a sim with this weapons table can actually run. `verbId` = the
// melee verb's weapon id (null = no melee): appends the KNIFE rung — the
// pistol carried empty, `knife: true`.
export function resolveTiers(weapons, verbId, base) {
  const list = (base || LADDER_TIERS).filter((t) => !weapons || weapons[t.weapon]);
  const tiers = list.map((t) => ({ weapon: t.weapon, attach: t.attach.slice(), knife: false }));
  const melee = !!verbId && (!weapons || !!weapons.pike);
  if (melee) tiers.push({ weapon: "pike", attach: [], knife: true });
  return { tiers, melee };
}

export function createMode(ctx) {
  const content = ctx.content || {};
  const st = {
    tiers: resolveTiers(null, MELEE_VERB_ID).tiers, melee: !!MELEE_VERB_ID,
    tier: new Int32Array(10),
    kills: new Int32Array(10),
    finisher: -1,
    leader: -1,
    prevPhase: "pre",
    otTied: null, otWinner: -1,
    pub: null,
    weapons: null,
  };

  function N() { return st.tiers.length; }

  function arm(m, actor) {
    const body = m.bodyOf(actor);
    const sim = m.sim;
    if (!body || !sim || typeof sim.setLadderWeapon !== "function") return;
    const tr = st.tiers[Math.min(st.tier[actor.actorId], N() - 1)];
    sim.setLadderWeapon(body, tr.weapon, tr.attach, !!tr.knife);
  }

  function emitL(m, state, actor, by) {
    const i = actor.actorId;
    const tr = st.tiers[Math.min(st.tier[i], N() - 1)];
    m.emit("ladder", {
      state, actorId: i, who: actor.who, tier: st.tier[i], of: N(),
      weapon: tr.knife ? "knife" : tr.weapon, attach: tr.attach.slice(), by: by ? by.who : null,
    });
  }

  // outright leader by rung (ties: no leader); published + "lead" event
  function leaderTick(m) {
    let best = -1, holder = -1, count = 0;
    for (const a of m.actors) {
      const t = st.tier[a.actorId];
      if (t > best) { best = t; holder = a.actorId; count = 1; } else if (t === best) count++;
    }
    const lead = count === 1 && best > 0 ? holder : -1;
    if (lead !== st.leader) {
      st.leader = lead;
      if (lead >= 0) emitL(m, "lead", m.actors[lead], null);
    }
    const p = st.pub.leader;
    p.actorId = lead; p.tier = best; p.tied = count;
    p.name = lead >= 0 ? m.actors[lead].name : "";
  }

  const hud = {
    headline: "ASCENT",
    clockS: 0, us: 0, them: 0,
    objectives: [{ id: "ladder_score", label: "", state: "active" }],
    markers: [],
  };

  const mode = {
    _st: st,
    id: "ladder",
    displayName: "ASCENT",
    teamCount: "perActor",
    forcedLoadout: true, // sim.js: no class kits, no loot / racks, no call-ins
    defaults: {
      scoreLimit: LADDER_TIERS.length, // replaced by the resolved rung count at start
      timeLimitS: LADDER_DEFAULTS.timeLimitS, respawnS: LADDER_DEFAULTS.respawnS,
      protectS: LADDER_DEFAULTS.protectS,
    },

    start(m) {
      const r = resolveTiers(m.weapons || null, MELEE_VERB_ID);
      st.tiers = r.tiers; st.melee = r.melee;
      m.rules.scoreLimit = N(); // the AI's situation read: "limit" = the ladder length
      st.tier.fill(0); st.kills.fill(0);
      st.finisher = -1; st.leader = -1; st.otTied = null; st.otWinner = -1;
      st.pub = m.state.mode;
      st.pub.tiers = st.tiers;
      st.pub.tier = Array.from(st.tier);
      st.pub.melee = st.melee;
      st.pub.leader = { actorId: -1, tier: 0, tied: 10, name: "" };
      st.pub.overtime = { tied: [] };
      for (const a of m.actors) { a.tier = 0; arm(m, a); }
    },

    // every life starts on the actor's current rung
    onSpawn(m, ev) { arm(m, ev.actor); },

    tick(m, dt) {
      const ph = m.phase;
      if (ph === "overtime" && st.prevPhase !== "overtime") {
        let best = -1;
        for (const a of m.actors) if (st.tier[a.actorId] > best) best = st.tier[a.actorId];
        st.otTied = [];
        for (const a of m.actors) if (st.tier[a.actorId] === best && a.alive) st.otTied.push(a.actorId);
        st.pub.overtime.tied = st.otTied.slice();
      }
      st.prevPhase = ph;
      if (ph === "live" || ph === "overtime") leaderTick(m);
      void dt;
    },

    end() { /* rungs freeze — the debrief reads them */ },

    onKill(m, ev) {
      if (m.phase !== "live" && m.phase !== "overtime") return;
      const A = ev.attacker, V = ev.victim;
      if (st.melee && isMeleeKill(ev.weaponId, MELEE_VERB_ID) && st.tier[V.actorId] > 0) {
        st.tier[V.actorId]--;
        V.tier = st.tier[V.actorId];
        m.addTeamScore(V.team, -1, "demote");
        emitL(m, "demoted", V, A);
      }
      st.kills[A.actorId]++;
      st.tier[A.actorId]++;
      A.tier = st.tier[A.actorId];
      m.addTeamScore(A.team, 1, "rung");
      if (st.tier[A.actorId] >= N()) {
        st.tier[A.actorId] = N();
        if (st.finisher < 0) st.finisher = A.actorId;
        m.emit("ladder", { state: "finished", actorId: A.actorId, who: A.who, tier: N(), of: N(), weapon: null, attach: [], by: null });
      } else {
        arm(m, A); // the new gun, right now
        emitL(m, "promoted", A, null);
      }
      if (m.phase === "overtime" && st.otTied && st.otTied.indexOf(A.actorId) >= 0 && st.otWinner < 0) {
        st.otWinner = A.actorId;
      }
      for (let i = 0; i < 10; i++) st.pub.tier[i] = st.tier[i];
    },

    onDeath(m, ev) {
      if (m.phase === "overtime" && st.otTied) {
        const ix = st.otTied.indexOf(ev.actor.actorId);
        if (ix >= 0) { st.otTied.splice(ix, 1); st.pub.overtime.tied = st.otTied.slice(); }
      }
    },

    spawnVeto() { return false; },

    checkWin(m) {
      if (st.finisher >= 0) {
        return { result: "win", winnerTeam: m.actors[st.finisher].team, reason: "ladder complete" };
      }
      if (m.phase === "live") {
        if (m.timeLeft > 0) return null;
        let best = -1, holder = -1, count = 0;
        for (const a of m.actors) {
          const t = st.tier[a.actorId];
          if (t > best) { best = t; holder = a.actorId; count = 1; } else if (t === best) count++;
        }
        if (count === 1) return { result: "win", winnerTeam: m.actors[holder].team, reason: "time (highest rung)" };
        let w = -1, bd = Infinity, tie = false;
        for (const a of m.actors) {
          if (st.tier[a.actorId] !== best) continue;
          if (a.deaths < bd) { bd = a.deaths; w = a.actorId; tie = false; } else if (a.deaths === bd) tie = true;
        }
        if (!tie && w >= 0) return { result: "win", winnerTeam: m.actors[w].team, reason: "time tiebreak (fewer deaths)" };
        return null; // → overtime
      }
      if (m.phase === "overtime") {
        if (!st.otTied) return null;
        if (st.otWinner >= 0) return { result: "win", winnerTeam: m.actors[st.otWinner].team, reason: "overtime kill" };
        if (st.otTied.length === 1) return { result: "win", winnerTeam: m.actors[st.otTied[0]].team, reason: "overtime last leader" };
        if (st.otTied.length === 0) return { result: "draw", winnerTeam: null, reason: "overtime leaders eliminated" };
        if (m.timeLeft <= DT * 1.5) return { result: "draw", winnerTeam: null, reason: "overtime cap (tie intact)" };
        return null;
      }
      return null;
    },

    hudModel(m) {
      hud.clockS = m.timeLeft;
      hud.us = st.tier[0];
      let lead = 0;
      for (let i = 1; i < 10; i++) if (st.tier[i] > lead) lead = st.tier[i];
      hud.them = lead;
      const o = hud.objectives[0];
      o.label = m.phase === "overtime" ? "OVERTIME — TIED LEADERS: FIRST KILL WINS"
        : "CLIMB THE LADDER — " + N() + " RUNGS";
      o.state = "active";
      return hud;
    },
  };
  return mode;
}
