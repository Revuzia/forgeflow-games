// core/ai/roles/ffa.js [W7] — FFA's solo objective pass (bot_ai.md Part 8).
// There is no commander in the team sense and NO RADIO: commsGroup is the
// bot's own id, so every bot is alone with its own eyes, its own ears, and
// the public scoreboard (bot_ai §4.4 / §8.5.1 — the structural anti-dogpile
// mechanism). Roles: hunt | lane | evade (+ survive for a leading bot late).
//
// Everything read here is the bot's OWN percept (byTarget awareness /
// lastKnown / heardAt) or Tier W (scores, clock, the leader identity the
// scoreboard shows everyone). No other actor's transform is ever read.

const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const HEARD_FRESH_S = 8.0;
const EVADE_HP = 60;            // §8.4 — below 60 hp a third party breaks you
const EVADE_THIRD_M = 20.0;
const LATE_FRAC = 0.75;         // §8.2 — leader term arms in the last 25 %

function bandOf(body) { return BAND_BY_ARCH[body.archetype] || [15, 35]; }

function driveTo(ctx, b, dest) {
  const { api, t } = ctx;
  const rec = b.rec, body = b.body;
  const stale = !rec.route || !rec.route.to || api.hdist(rec.route.to, dest) > 6;
  if (stale && (t - rec.routeAt >= ctx.latchS.route || !rec.route)) {
    rec.route = api.buildRoute(body.pos, dest, null);
    rec.routeAt = t;
  }
  const anchor = rec.route ? api.followRoute(rec, body) : null;
  return anchor || dest;
}

export function assign(ctx) {
  const { m, t, api, bots, rules } = ctx;
  const R = api.REASONS;
  const g = ctx.g;
  const limit = rules.scoreLimit || 25;
  const timeLimit = rules.timeLimitS || 480;
  const elapsed = m.state.elapsed || 0;
  const late = timeLimit > 0 && elapsed / timeLimit >= LATE_FRAC;

  // the public scoreboard: leader identity (ties → lowest id, deterministic)
  let leaderId = -1, leaderScore = -1;
  const scoreOf = new Map();
  for (const tt of m.state.teams) {
    scoreOf.set(tt.id, tt.score);
    if (tt.score > leaderScore) { leaderScore = tt.score; leaderId = tt.id; }
  }
  const leaderArmed = late || leaderScore >= limit - 2;

  const laneList = [];
  for (const L of g.lanes) {
    if (L.throughGoing === false || L.botTraversable === false || L.a === L.b) continue;
    laneList.push(L);
  }

  for (const b of bots) {
    const { actor, body, rec } = b;
    const P = body.percept;
    const myScore = scoreOf.get(actor.team) || 0;
    const iLead = actor.team === leaderId && leaderScore > 0;
    const behind = leaderScore - myScore >= 3;
    const engaged = api.engagedNow(body);
    const matchPoint = myScore >= limit - 1;

    // ---- EVADE (§8.4): in a fight, hp < 60, a THIRD actor perceived close.
    // Rolled once and latched 4 s — the rec latch does exactly that.
    if (engaged && body.hp < EVADE_HP && P && P.byTarget) {
      let close = 0;
      const threats = [];
      for (const who in P.byTarget) {
        const r = P.byTarget[who];
        if (!r || r.awareness < 0.5 || !r.lastKnown) continue;
        if (api.hdist(body.pos, r.lastKnown) <= EVADE_THIRD_M) { close++; threats.push(r.lastKnown); }
      }
      if (close >= 2) {
        if (rec.role === "evade" && t < rec.holdUntil) {
          api.write(rec, body, {
            role: "evade", reason: R.EVADE, anchor: rec.obj.anchor, anchorKind: "freeform",
            priority: 0.75, firePolicy: "defensive", selfDefenseM: 12, posture: "balanced",
          });
          continue;
        }
        // cover node maximising the min distance to both known threats
        let best = null, bestD = -1;
        for (const L of laneList) {
          for (const wp of L.wp) {
            let minD = Infinity;
            for (const th of threats) minD = Math.min(minD, api.hdist(wp, th));
            const d = minD - 0.3 * api.hdist(body.pos, wp);
            if (d > bestD && api.hdist(body.pos, wp) < 40) { bestD = d; best = wp; }
          }
        }
        rec.route = null;
        api.write(rec, body, {
          role: "evade", reason: R.EVADE,
          anchor: best ? best.slice() : null, anchorKind: "freeform",
          priority: 0.75, firePolicy: "defensive", selfDefenseM: 12, posture: "balanced",
          holdS: 4, rearm: rec.role !== "evade",
        });
        continue;
      }
    }

    // ---- SURVIVE: the leading bot plays the edges late (§8.6)
    if (iLead && leaderArmed && !matchPoint) {
      const heard = P && P.heardAt && t - P.lastHeardT <= HEARD_FRESH_S ? P.heardAt : null;
      let best = null, bestU = -Infinity;
      for (const L of laneList) {
        for (const wp of L.wp) {
          let u = -1.2 * (L.exposure || 0.5) + 0.6 * (L.cover || 0.5);
          if (heard) u += Math.min(1, api.hdist(wp, heard) / 25) - 1; // ≥25 m off the noise
          u -= 0.02 * api.hdist(body.pos, wp);
          if (u > bestU) { bestU = u; best = wp; }
        }
      }
      const anchor = best ? driveTo(ctx, b, [best[0], best[1], best[2]]) : null;
      api.write(rec, body, {
        role: "evade", reason: R.SURVIVE, anchor, anchorKind: "lane", routeUse: true,
        priority: engaged ? 0.45 : 0.7, firePolicy: "free", posture: "control",
        noFlank: true,
      });
      continue;
    }

    // ---- HUNT: behind late — go where the shooting is (own ears only, §8.6)
    const heardFresh = P && P.heardAt && t - P.lastHeardT <= HEARD_FRESH_S;
    if ((behind && leaderArmed) || matchPoint) {
      let dest = null;
      if (heardFresh) dest = P.heardAt;
      else if (P && P.lastKnown && t - P.lastSeenT <= HEARD_FRESH_S) dest = P.lastKnown;
      if (dest) {
        const anchor = driveTo(ctx, b, [dest[0], dest[1], dest[2]]);
        api.write(rec, body, {
          role: "hunt", reason: R.HUNT, anchor, anchorKind: "freeform", routeUse: true,
          priority: engaged ? 0.45 : 0.85, firePolicy: "free", posture: "press",
        });
        continue;
      }
      // nothing heard: fall through to lane roam at press
    }

    // ---- default: lane roam on own knowledge (latched 8 s)
    let laneId = rec.laneLatchId;
    if (!laneId || t >= rec.laneLatchUntil) {
      let best = null, bestU = -Infinity;
      for (const L of laneList) {
        const mid = L.wp[Math.floor(L.wp.length / 2)];
        const band = bandOf(body);
        const overlap = Math.min(band[1], L.band ? L.band[1] : 30) - Math.max(band[0], L.band ? L.band[0] : 8);
        let u = 1.2 * (overlap > 0 ? Math.min(1, overlap / 15) : 0);
        if (heardFresh) u += 1.0 * (1 - Math.min(1, api.hdist(mid, P.heardAt) / 40));
        u -= 0.5 * (api.hdist(body.pos, mid) / 60);
        // deterministic per-bot spread so nine solo bots do not all pick the
        // same lane from identical public facts
        u += 0.15 * ((body.id * 7 + L.id.length * 3) % 5);
        if (u > bestU) { bestU = u; best = L; }
      }
      if (best) { laneId = best.id; rec.laneLatchId = laneId; rec.laneLatchUntil = t + ctx.latchS.lane; }
    }
    const L = laneId ? g.byId[laneId] : null;
    if (!L) {
      api.write(rec, body, { role: "lane", reason: R.LANE_QUOTA, anchor: null, priority: 0, firePolicy: "free", posture: "balanced" });
      continue;
    }
    const far = api.hdist(body.pos, api.junctionPos(L.a)) > api.hdist(body.pos, api.junctionPos(L.b))
      ? api.junctionPos(L.a) : api.junctionPos(L.b);
    const anchor = driveTo(ctx, b, [far[0], far[1], far[2]]);
    api.write(rec, body, {
      role: "lane", reason: R.LANE_QUOTA, anchor, anchorKind: "lane", routeUse: true,
      priority: engaged ? 0.45 : ((behind && leaderArmed) || matchPoint ? 0.85 : 0.75),
      firePolicy: "free",
      posture: (behind && leaderArmed) || matchPoint ? "press" : "balanced",
    });
  }
}
