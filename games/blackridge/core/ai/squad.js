// core/ai/squad.js [A5] — squad director (combat_spec §5.4/§5.7), bark
// scheduling (§5.10 / R13 kinds), engagement referee (§5.3: 40 s forced
// flank / 75 s push / 90 s episode close — every engagement ends, doctrine
// §2). THREE-free, deterministic (no rng here; all rolls live in botfsm).
// Frozen signatures: makeSquad() → { requestToken, release, claimFlank,
// reset }; everything else is a private addition.
//
// Token model: ≤2 fire tokens + 1 suppress token PER SQUAD (bots with no
// squadId share the "_default" squad — test spawns via sim.spawnBot land
// there so the caps still bind). Re-arbitrated every 4 s or on a holder's
// death; nearest-with-LOS wins ties (§5.7).
//
// Cross-squad cap: ≤3 damaging attackers on the player in any 250 ms window,
// mission-wide (§5.7). Enforced at fire-authorization time: a bot may hold
// its trigger only while it is one of ≤3 bots authorized within the last
// 250 ms — stricter than the damaging-attacker reading, so the probe bound
// holds by construction.
//
// Referee (per-engagement clock, resets on ANY damage or death):
//   40 s  → force one FLANK + reset grenade eligibility
//   75 s  → push: all preferred ranges halve, 'push' bark
//   90 s  → episode CLOSE: combat-family bots drop to 'suspicious'
//           (investigate last-known) — the engagement ends structurally.
// Also 'push' on player damaged ≥60 within 3 s (§5.10 trigger).

const REARB_S = 4.0;
const FIRE_WINDOW_S = 0.25;
const FIRE_WINDOW_MAX = 3;
const FLANK_AT_S = 40;
const PUSH_AT_S = 75;
const EPISODE_MAX_S = 90;
const GRENADE_COOLDOWN_S = 20;

const BARK_PRI = { grenade: 4, down: 3, lastman: 3, flank: 2, contact: 2, push: 2, hit: 1, reload: 1, idle: 0 };
// priority ≥3 (man-down family) and the fairness telegraphs (§5.9/§5.3
// grenade/flank) bypass the cooldowns — a once-per-fight line must not be
// eaten by a flavor bark 2 s earlier.
const BARK_MANDATORY = { grenade: true, flank: true };

export function makeSquad() {
  let sim = null;

  const squads = new Map(); // squadId → entry
  const fireWindow = new Map(); // botId → last fire-auth time
  const barkBot = new Map(); // botId → last bark t
  let barkGlobalT = -9;

  const referee = {
    active: false, startT: 0, lastEventT: 0,
    flankDone: false, pushOn: false, log: [],
  };
  let prevDmg = 0, prevDeaths = 0;
  let lastAliveIds = [];
  const dmgTakenRing = [];
  const playerStatic = { ax: 0, az: 0, sinceT: 0, init: false };
  const warnedGrenades = new WeakSet();

  function entry(sqId) {
    let e = squads.get(sqId);
    if (!e) {
      e = {
        fire: new Set(), suppress: null, flank: { L: null, R: null },
        grenadeReadyT: 0, lastArbT: -9, contactT: -99,
        lastKnown: null, lastKnownT: -9, prevAlive: -1,
      };
      squads.set(sqId, e);
    }
    return e;
  }

  function botById(id) {
    if (!sim) return null;
    const bots = sim.state.bots;
    for (let i = 0; i < bots.length; i++) if (bots[i].id === id) return bots[i];
    return null;
  }
  function squadIdOf(botId) {
    const b = botById(botId);
    return b && b.squadId ? b.squadId : "_default";
  }
  function inCombatFamily(b) {
    return b.state === "combat" || b.state === "flank" || b.state === "suppress";
  }

  const squad = {
    // ---------------------------------------------------- frozen surface
    requestToken(botId) {
      const e = entry(squadIdOf(botId));
      if (e.fire.has(botId)) return true;
      // prune invalid holders before deciding
      for (const id of [...e.fire]) {
        const b = botById(id);
        if (!b || !b.alive || !inCombatFamily(b)) e.fire.delete(id);
      }
      if (e.fire.size < 2) { e.fire.add(botId); return true; }
      return false;
    },

    release(botId) {
      const e = entry(squadIdOf(botId));
      e.fire.delete(botId);
      if (e.suppress === botId) e.suppress = null;
      if (e.flank.L === botId) e.flank.L = null;
      if (e.flank.R === botId) e.flank.R = null;
    },

    claimFlank(botId, side) {
      const e = entry(squadIdOf(botId));
      const cur = e.flank[side];
      if (cur != null && cur !== botId) {
        const b = botById(cur);
        if (b && b.alive && b.state === "flank") return false;
      }
      e.flank[side] = botId;
      return true;
    },

    reset() {
      squads.clear(); fireWindow.clear(); barkBot.clear();
      barkGlobalT = -9;
      referee.active = false; referee.flankDone = false; referee.pushOn = false;
      referee.log.length = 0;
      dmgTakenRing.length = 0;
      lastAliveIds = [];
      playerStatic.init = false;
      prevDmg = 0; prevDeaths = 0;
    },

    // ---------------------------------------------------- private surface
    _bind(s) { sim = s; },

    requestSuppress(botId) {
      const e = entry(squadIdOf(botId));
      if (e.suppress === botId) return true;
      if (e.fire.has(botId)) return false; // fire-token holders shoot, not spray
      if (e.suppress != null) {
        const b = botById(e.suppress);
        if (b && b.alive && inCombatFamily(b)) return false;
      }
      e.suppress = botId;
      return true;
    },
    holdsSuppress(botId) { return entry(squadIdOf(botId)).suppress === botId; },
    holdsFire(botId) { return entry(squadIdOf(botId)).fire.has(botId); },

    // fire authorization — the mission-wide ≤3-in-250 ms window
    fireAuthOk(botId, t) {
      for (const [id, at] of fireWindow) if (t - at > FIRE_WINDOW_S) fireWindow.delete(id);
      return fireWindow.has(botId) || fireWindow.size < FIRE_WINDOW_MAX;
    },
    noteFireAuth(botId, t) { fireWindow.set(botId, t); },

    noteLastKnown(botId, pos, t) {
      const e = entry(squadIdOf(botId));
      e.lastKnown = pos.slice();
      e.lastKnownT = t;
    },
    squadLastKnown(botId) {
      const e = entry(squadIdOf(botId));
      return e.lastKnown ? { pos: e.lastKnown, t: e.lastKnownT } : null;
    },
    noteConfirm(botId, t) {
      const e = entry(squadIdOf(botId));
      if (t - e.contactT > 10) {
        e.contactT = t;
        squad.requestBark(botId, "contact");
      }
    },
    grenadeReady(botId, t) {
      const e = entry(squadIdOf(botId));
      return t >= e.grenadeReadyT;
    },
    noteGrenade(botId, t) {
      entry(squadIdOf(botId)).grenadeReadyT = t + GRENADE_COOLDOWN_S;
    },
    pushActive() { return referee.pushOn; },
    playerStaticFor(t) { return playerStatic.init ? t - playerStatic.sinceT : 0; },

    requestBark(botId, kind) {
      if (!sim) return false;
      const t = sim.state.time;
      const pri = BARK_PRI[kind] != null ? BARK_PRI[kind] : 1;
      const mandatory = !!BARK_MANDATORY[kind] || pri >= 3;
      if (!mandatory) {
        const bt = barkBot.get(botId);
        if (bt != null && t - bt < 4.0) return false; // per-bot 4 s
        if (t - barkGlobalT < 2.0) return false;      // global 2 s
      }
      barkBot.set(botId, t);
      barkGlobalT = t;
      sim.emit("bark", { botId, kind });
      return true;
    },

    _debug() {
      const tokens = {};
      for (const [k, e] of squads) tokens[k] = { fire: [...e.fire], suppress: e.suppress };
      return {
        tokens, refereeLog: referee.log.slice(), pushOn: referee.pushOn,
        fireWindowSize: fireWindow.size, active: referee.active,
        lastEventT: referee.lastEventT,
      };
    },

    // one call per sim tick, from aiStep (slot 3)
    _tick(s, dt) {
      sim = s;
      const S = sim.state;
      const t = S.time;
      const bots = S.bots;

      // ---- prune dead holders + per-squad alive counts / lastman barks
      const aliveBySquad = new Map();
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        if (!b.alive) continue;
        const k = b.squadId || "_default";
        aliveBySquad.set(k, (aliveBySquad.get(k) || 0) + 1);
      }
      for (const [k, e] of squads) {
        for (const id of [...e.fire]) {
          const b = botById(id);
          if (!b || !b.alive) e.fire.delete(id);
        }
        if (e.suppress != null) {
          const b = botById(e.suppress);
          if (!b || !b.alive) e.suppress = null;
        }
        for (const side of ["L", "R"]) {
          if (e.flank[side] != null) {
            const b = botById(e.flank[side]);
            if (!b || !b.alive || b.state !== "flank") e.flank[side] = null;
          }
        }
        const alive = aliveBySquad.get(k) || 0;
        if (e.prevAlive >= 2 && alive === 1 && referee.active) {
          for (let i = 0; i < bots.length; i++) {
            const b = bots[i];
            if (b.alive && (b.squadId || "_default") === k) {
              squad.requestBark(b.id, "lastman");
              break;
            }
          }
        }
        e.prevAlive = alive;
      }

      // ---- 'down' barks: newly dead bots, surviving squadmate w/ LOS to body
      const aliveIds = [];
      for (let i = 0; i < bots.length; i++) if (bots[i].alive) aliveIds.push(bots[i].id);
      if (lastAliveIds.length) {
        for (const id of lastAliveIds) {
          if (aliveIds.indexOf(id) >= 0) continue;
          const dead = botById(id);
          if (!dead) continue;
          const k = dead.squadId || "_default";
          for (let i = 0; i < bots.length; i++) {
            const b = bots[i];
            if (!b.alive || (b.squadId || "_default") !== k || b.id === id) continue;
            const eye = [b.pos[0], b.pos[1] + 1.62, b.pos[2]];
            const body = [dead.pos[0], dead.pos[1] + 0.4, dead.pos[2]];
            if (!sim.world.losBlocked(eye, body)) { squad.requestBark(b.id, "down"); break; }
          }
        }
      }
      lastAliveIds = aliveIds;

      // ---- fire-token re-arbitration (every 4 s per squad): nearest-with-
      // LOS wins ties (§5.7). Deterministic sort (sees desc, dist asc, id).
      const p = S.player;
      for (const [k, e] of squads) {
        if (t - e.lastArbT < REARB_S) continue;
        e.lastArbT = t;
        const cands = [];
        for (let i = 0; i < bots.length; i++) {
          const b = bots[i];
          if (!b.alive || (b.squadId || "_default") !== k) continue;
          if (!(b.state === "combat" || b.state === "suppress")) continue;
          const sees = b.percept && b.percept.seesPlayer ? 1 : 0;
          const d = Math.hypot(b.pos[0] - p.pos[0], b.pos[2] - p.pos[2]);
          cands.push({ id: b.id, sees, d });
        }
        cands.sort((a, b) => (b.sees - a.sees) || (a.d - b.d) || (a.id - b.id));
        e.fire.clear();
        for (let i = 0; i < Math.min(2, cands.length); i++) e.fire.add(cands[i].id);
        e.suppress = cands.length > 2 ? cands[2].id : null;
      }

      // ---- damage/death watch (either way) → referee clock resets
      const dmgNow = S.counters.damageDealt + S.counters.damageTaken;
      const deathsNow = S.counters.deaths + S.counters.kills;
      const evented = dmgNow !== prevDmg || deathsNow !== prevDeaths;
      if (S.counters.damageTaken > 0 || dmgTakenRing.length) {
        // ring for the ≥60-in-3 s push trigger
        const dTaken = S.counters.damageTaken - (dmgTakenRing._prev || 0);
        if (dTaken > 0) dmgTakenRing.push({ t, amt: dTaken });
        dmgTakenRing._prev = S.counters.damageTaken;
        while (dmgTakenRing.length && t - dmgTakenRing[0].t > 3) dmgTakenRing.shift();
      }
      prevDmg = dmgNow;
      prevDeaths = deathsNow;

      // ---- engagement referee
      let engaged = false;
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        if (b.alive && inCombatFamily(b)) { engaged = true; break; }
      }
      if (engaged && !referee.active) {
        referee.active = true;
        referee.startT = t;
        referee.lastEventT = t;
        referee.flankDone = false;
        referee.pushOn = false;
      } else if (!engaged && referee.active) {
        referee.active = false;
        referee.pushOn = false;
      }
      if (referee.active) {
        if (evented) {
          referee.lastEventT = t;
          referee.flankDone = false;
          referee.pushOn = false;
        }
        const elapsed = t - referee.lastEventT;
        if (elapsed >= FLANK_AT_S && !referee.flankDone) {
          referee.flankDone = true;
          referee.log.push({ kind: "flank", t, elapsed });
          // pick a combat bot, preferring a token-less one (lowest id)
          let pick = null;
          for (let i = 0; i < bots.length; i++) {
            const b = bots[i];
            if (!b.alive || b.state !== "combat") continue;
            const holds = entry(b.squadId || "_default").fire.has(b.id);
            if (!pick || (!holds && pick.holds)) pick = { b, holds };
            if (!holds) break;
          }
          if (pick && pick.b._brain) pick.b._brain.forceFlank = true;
          for (const [, e] of squads) e.grenadeReadyT = 0; // reset eligibility
        }
        if (elapsed >= PUSH_AT_S && !referee.pushOn) {
          referee.pushOn = true;
          referee.log.push({ kind: "push", t, elapsed });
          for (let i = 0; i < bots.length; i++) {
            const b = bots[i];
            if (b.alive && b.state === "combat") { squad.requestBark(b.id, "push"); break; }
          }
        }
        if (elapsed >= EPISODE_MAX_S) {
          referee.log.push({ kind: "episode_end", t, elapsed });
          referee.lastEventT = t;
          referee.flankDone = false;
          referee.pushOn = false;
          for (let i = 0; i < bots.length; i++) {
            const b = bots[i];
            if (b.alive && inCombatFamily(b) && b._brain) b._brain.forceDisengage = true;
          }
        }
      }
      // push on burst damage (§5.10: player damaged ≥60 in 3 s)
      if (referee.active && !referee.pushOn) {
        let sum = 0;
        for (let i = 0; i < dmgTakenRing.length; i++) sum += dmgTakenRing[i].amt;
        if (sum >= 60) {
          referee.pushOn = true;
          referee.log.push({ kind: "push", t, elapsed: t - referee.lastEventT, cause: "burst-damage" });
          for (let i = 0; i < bots.length; i++) {
            const b = bots[i];
            if (b.alive && b.state === "combat") { squad.requestBark(b.id, "push"); break; }
          }
        }
      }

      // ---- player-static tracking (grenade eligibility, §5.9)
      if (!playerStatic.init || Math.hypot(p.pos[0] - playerStatic.ax, p.pos[2] - playerStatic.az) > 2.5) {
        playerStatic.ax = p.pos[0];
        playerStatic.az = p.pos[2];
        playerStatic.sinceT = t;
        playerStatic.init = true;
      }

      // ---- player-grenade warning bark ("Grenade! Move!" — §5.10)
      const gl = sim.internal && sim.internal.grenades;
      if (gl) {
        for (let i = 0; i < gl.length; i++) {
          const g = gl[i];
          if (g.who !== "P" || (!g.bounced && !g.landed) || warnedGrenades.has(g)) continue;
          let nearest = null, nd = 8;
          for (let j = 0; j < bots.length; j++) {
            const b = bots[j];
            if (!b.alive) continue;
            const d = Math.hypot(b.pos[0] - g.pos[0], b.pos[2] - g.pos[2]);
            if (d < nd) { nd = d; nearest = b; }
          }
          if (nearest) {
            warnedGrenades.add(g);
            squad.requestBark(nearest.id, "grenade");
          }
        }
      }
    },
  };

  return squad;
}
