// core/ai/comms.js [W7] — the team blackboard: Tier R of the information
// model (PVP_BUILD_PLAN Part 3.8; bot_ai.md Part 4.2; C21). THREE-free,
// deterministic, allocation-light (ring slots reused).
//
// Keyed by commsGroup: team id string ("t0"/"t1") in TDM/CTF, the bot's own
// id ("b<botId>") in FFA — so in FFA the radio is EMPTY BY CONSTRUCTION
// (every group has one member; nothing a bot writes is ever read by another
// actor). That structural absence is the first of the four anti-dogpile
// mechanisms (bot_ai §8.5.1) and T-FFA-1 asserts it via the counters below.
//
// What a group may carry, and no more (bot_ai §4.2's table):
//   - enemy contact ring: ≤ CONTACT_CAP {who, pos, t} entries, dropped after
//     CONTACT_TTL_S. Written ONLY from a teammate's own percept output
//     (objective.js harvests percept.byTarget lastKnowns at the commander
//     cadence) — never from a live transform.
//   - objective calls (escortme / intercept / returning / flagtaken):
//     flags, not positions; dropped after CALL_TTL_S.
// Teammate position/hp/role are NOT stored here — the commander reads its
// own team's actors through the match facade (they are on your team; the
// human's HUD shows the same pips).
//
// HARD RULE (Part 3.8): a Tier-R fact may set a goal. It may never set an
// aim point. Nothing in this file is ever handed to the trigger path —
// botfsm's fire code reads squad.js's per-squad blackboard and the bot's own
// percept, and this module is imported by objective.js/roles only.

export const CONTACT_CAP = 6;
export const CONTACT_TTL_S = 8.0;
export const CALL_TTL_S = 6.0;

export function makeComms() {
  const groups = new Map(); // gid → {ring:[], calls:[]}
  const counters = { writes: 0, teamWrites: 0, soloWrites: 0 };

  function grp(gid) {
    let g = groups.get(gid);
    if (!g) {
      g = { ring: [], calls: [] };
      for (let i = 0; i < CONTACT_CAP; i++) g.ring.push({ who: null, pos: [0, 0, 0], t: -1e9 });
      groups.set(gid, g);
    }
    return g;
  }

  return {
    counters,

    // a teammate perceived an enemy: write the writer's OWN last-known.
    // Dedupe per `who` (newest wins); evict the stalest slot when full.
    noteContact(gid, who, pos, t) {
      const g = grp(gid);
      counters.writes++;
      if (gid.charCodeAt(0) === 116 /* 't' — team group */) counters.teamWrites++;
      else counters.soloWrites++;
      let slot = null, oldest = null, oldestT = Infinity;
      for (const s of g.ring) {
        if (s.who === who) { slot = s; break; }
        if (s.t < oldestT) { oldestT = s.t; oldest = s; }
      }
      if (!slot) slot = oldest;
      if (t < slot.t) return; // never regress a fresher entry
      slot.who = who;
      slot.pos[0] = pos[0]; slot.pos[1] = pos[1]; slot.pos[2] = pos[2];
      slot.t = t;
    },

    // fresh contacts (≤ CONTACT_CAP, ≤ CONTACT_TTL_S old), into `out`.
    contacts(gid, t, out) {
      out.length = 0;
      const g = groups.get(gid);
      if (!g) return out;
      for (const s of g.ring) {
        if (s.who != null && t - s.t <= CONTACT_TTL_S) out.push(s);
      }
      return out;
    },

    // decayed density of contacts within `radius` of a point (route scoring)
    contactWeightNear(gid, t, x, z, radius) {
      const g = groups.get(gid);
      if (!g) return 0;
      let w = 0;
      for (const s of g.ring) {
        if (s.who == null || t - s.t > CONTACT_TTL_S) continue;
        const d = Math.hypot(s.pos[0] - x, s.pos[2] - z);
        if (d <= radius) w += 1 - (t - s.t) / CONTACT_TTL_S;
      }
      return w;
    },

    // objective calls — flags only, never positions of enemies
    call(gid, kind, byWho, t) {
      const g = grp(gid);
      counters.writes++;
      if (gid.charCodeAt(0) === 116) counters.teamWrites++;
      else counters.soloWrites++;
      for (const c of g.calls) {
        if (c.kind === kind && c.byWho === byWho) { c.t = t; return; }
      }
      g.calls.push({ kind, byWho, t });
      if (g.calls.length > 8) g.calls.shift();
    },

    hasCall(gid, kind, t) {
      const g = groups.get(gid);
      if (!g) return false;
      for (const c of g.calls) if (c.kind === kind && t - c.t <= CALL_TTL_S) return true;
      return false;
    },

    reset() { groups.clear(); counters.writes = 0; counters.teamWrites = 0; counters.soloWrites = 0; },
    _groups: groups, // selftest introspection only
  };
}
