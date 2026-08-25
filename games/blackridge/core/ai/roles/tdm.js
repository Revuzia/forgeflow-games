// core/ai/roles/tdm.js [W7] — TDM's quota table and role utilities
// (bot_ai.md Part 6; PVP_BUILD_PLAN C9). One role — 'lane' — plus the
// mode-duty overlays (trade / attack / defend / collapse). What
// differentiates a good deathmatch team is WHERE it is, so this module is
// mostly the anti-funnel lane quota and the push/hold judgement.
//
// Consumes actor.duty (the MODE's channel — what the rules want) and writes
// bot._obj through ctx.api (the AI's channel — where to stand, which lane,
// whether to shoot). Everything read here is Tier P (own percept), Tier R
// (team comms) or Tier W (duty targets, score, killfeed positions).
//
// THE PACE FIX (gate-2 playtest: kills collapsed mid-match as leaderless
// bots stalled): a bot with no fresh contact gets priority ≥0.75 — the H1
// hook then OWNS its goal even in combat state, so bots keep moving down
// lanes toward the fight instead of statuing at a stale last-known for the
// referee's full 90 s episode. While actually engaged, priority drops to
// 0.45 and the audited FSM fights exactly as shipped.

const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const GIVEUP_WINDOW_S = 10.0;   // §6.3 — 2 team deaths on a lane → rotate
const GIVEUP_NEAR_M = 10.0;

function bandOf(body) { return BAND_BY_ARCH[body.archetype] || [15, 35]; }

function laneQuota(posture) { return posture === "press" ? 3 : 2; }

// (re)build the bot's route toward `dest` and return the current anchor wp
function driveTo(ctx, b, dest) {
  const { api, t } = ctx;
  const rec = b.rec, body = b.body;
  const stale = !rec.route || !rec.route.to || api.hdist(rec.route.to, dest) > 6 ||
    (t - rec.routeAt > ctx.latchS.route && api.hdist(rec.route.to, dest) > 2);
  if (stale) {
    rec.route = api.buildRoute(body.pos, dest, api.routeCost(bandOf(body)));
    rec.routeAt = t;
  }
  const anchor = rec.route ? api.followRoute(rec, body) : null;
  return anchor || dest;
}

export function assign(ctx) {
  const { m, t, api, bots, posture, sit } = ctx;
  const R = api.REASONS;
  const g = ctx.g;
  const B = m.arena && m.arena.bounds ? m.arena.bounds : null;
  const mapDiag = B ? Math.hypot(B.max[0] - B.min[0], B.max[2] - B.min[2]) : 90;

  // candidate lanes (throughGoing:false is a post, never a route)
  const laneList = [];
  for (const L of g.lanes) {
    if (L.throughGoing === false || L.botTraversable === false || L.a === L.b) continue;
    laneList.push(L);
  }

  // give-up map: lanes with ≥2 own-team deaths inside the window (§6.3)
  const hotLanes = new Set();
  {
    const cnt = new Map();
    for (const d of api.deathRing) {
      if (d.team !== ctx.team || t - d.t > GIVEUP_WINDOW_S) continue;
      const nl = api.nearestLane(d.pos);
      if (nl && nl.dist <= GIVEUP_NEAR_M) cnt.set(nl.lane.id, (cnt.get(nl.lane.id) || 0) + 1);
    }
    for (const [id, n] of cnt) if (n >= 2) hotLanes.add(id);
  }

  // own-team home centroid (control halfness) from duty 'defend' targets or
  // the team's own cluster anchors
  let homeX = 0, homeZ = 0, homeN = 0;
  {
    const clusters = m.clusters || {};
    const hc = (m.rules && m.rules.homeClusters && m.rules.homeClusters[ctx.team]) || null;
    for (const k of Object.keys(clusters).sort()) {
      if (hc && !hc.includes(k)) continue;
      const cl = clusters[k];
      if (cl && cl.anchor) { homeX += cl.anchor[0]; homeZ += cl.anchor[2]; homeN++; }
    }
    if (homeN) { homeX /= homeN; homeZ /= homeN; }
  }

  // match point (§6.5): the last kill changes both teams' shape
  const matchPointUs = sit.limit > 0 && sit.us >= sit.limit - 1;
  const matchPointThem = sit.limit > 0 && sit.them >= sit.limit - 1;
  const effPosture = matchPointThem ? "press" : posture;

  const quota = laneQuota(effPosture);
  const occupancy = new Map(); // laneId → count of teammates latched to it
  for (const b of bots) {
    if (b.rec.laneLatchId && t < b.rec.laneLatchUntil) {
      occupancy.set(b.rec.laneLatchId, (occupancy.get(b.rec.laneLatchId) || 0) + 1);
    } else {
      b.rec.laneLatchId = null;
    }
  }

  const contactW = (x, z) => api.comms.contactWeightNear(ctx.gid, t, x, z, 10);

  function laneUtility(L, b) {
    const mid = L.wp[Math.floor(L.wp.length / 2)];
    const band = bandOf(b.body);
    const overlap = Math.min(band[1], L.band ? L.band[1] : 30) - Math.max(band[0], L.band ? L.band[0] : 8);
    const bandFit = overlap > 0 ? Math.min(1, overlap / 15) : 0;
    let u = 1.4 * bandFit;
    u += 1.1 * Math.min(2, contactW(mid[0], mid[2]));
    if (effPosture === "press") {
      // enemyward: toward the freshest known contact mass; matchpoint-trailing
      // flips to the EMPTIEST lane — the last kill is cheaper there (§6.5)
      const cw = Math.min(2, contactW(mid[0], mid[2]));
      u += matchPointThem ? 0.7 * (1 - cw / 2) : 0.7 * (cw / 2);
    } else if (effPosture === "control" && homeN) {
      u += 0.7 * (1 - Math.min(1, Math.hypot(mid[0] - homeX, mid[2] - homeZ) / (mapDiag * 0.6)));
    }
    const occ = occupancy.get(L.id) || 0;
    u -= 1.5 * (occ / quota);
    const entry = api.junctionPos(L.a);
    u -= 0.6 * (api.hdist(b.body.pos, entry) / mapDiag);
    if (hotLanes.has(L.id)) u -= 3.0; // stop feeding the meat grinder
    return u;
  }

  for (const b of bots) {
    const { actor, body, rec } = b;
    const duty = actor.duty;
    const engaged = api.engagedNow(body);
    const basePri = engaged ? 0.45 : 0.8;

    // ---- COLLAPSE overrides everything (the ring is the only objective)
    if (duty && duty.role === "collapse" && duty.target) {
      api.write(rec, body, {
        role: "lane", reason: R.COLLAPSE, anchor: duty.target.slice(), anchorKind: "freeform",
        priority: 1.0, firePolicy: "free", posture: "press", holdS: 2,
      });
      continue;
    }

    // ---- trade overlay (duty channel; the ≤2 cap lives in the mode)
    if (duty && duty.role === "trade" && duty.target) {
      const anchor = driveTo(ctx, b, [duty.target[0], duty.target[1], duty.target[2]]);
      api.write(rec, body, {
        role: "trade", reason: R.TRADE, anchor, anchorKind: "freeform", routeUse: true,
        priority: engaged ? 0.45 : 0.8, firePolicy: "free", posture: effPosture, holdS: 6,
      });
      continue;
    }

    // ---- defend duty: hold the home anchor
    if (duty && duty.role === "defend" && duty.target) {
      api.write(rec, body, {
        role: "defend", reason: R.DUTY, anchor: duty.target.slice(), anchorKind: "station",
        priority: engaged ? 0.45 : 0.65, firePolicy: "free", posture: effPosture,
        noFlank: effPosture === "control" || matchPointUs,
      });
      continue;
    }

    // ---- attack duty: drive at the contact centroid down a lane
    if (duty && duty.role === "attack" && duty.target) {
      const anchor = driveTo(ctx, b, [duty.target[0], duty.target[1], duty.target[2]]);
      api.write(rec, body, {
        role: "attack", reason: effPosture === "press" ? R.POSTURE_PRESS : R.LANE_PUSH,
        anchor, anchorKind: "lane", routeUse: true,
        priority: basePri, firePolicy: "free", posture: effPosture,
        noFlank: matchPointUs,
      });
      continue;
    }

    // ---- lane assignment (roam / no duty): the anti-funnel quota
    let laneId = rec.laneLatchId;
    if (!laneId || t >= rec.laneLatchUntil || hotLanes.has(laneId)) {
      let best = null, bestU = -Infinity;
      for (const L of laneList) {
        const u = laneUtility(L, b);
        if (u > bestU) { bestU = u; best = L; }
      }
      if (best) {
        const rotated = laneId && laneId !== best.id && hotLanes.has(laneId);
        laneId = best.id;
        rec.laneLatchId = laneId;
        rec.laneLatchUntil = t + ctx.latchS.lane;
        occupancy.set(laneId, (occupancy.get(laneId) || 0) + 1);
        rec._laneRotated = rotated;
      }
    }
    const L = laneId ? g.byId[laneId] : null;
    if (!L) {
      // no graph data at all: leave the FSM alone
      api.write(rec, body, {
        role: "lane", reason: R.LANE_QUOTA, anchor: null, priority: 0,
        firePolicy: "free", posture: effPosture,
      });
      continue;
    }

    // push or hold the lane (§6.3) — judged locally
    const mid = L.wp[Math.floor(L.wp.length / 2)];
    const friendsOn = occupancy.get(L.id) || 1;
    const enemyOn = contactW(mid[0], mid[2]);
    const push = friendsOn >= 2 && enemyOn <= 1 && effPosture !== "control";
    // destination: far junction when pushing, lane midpoint otherwise
    const far = api.hdist(body.pos, api.junctionPos(L.a)) > api.hdist(body.pos, api.junctionPos(L.b))
      ? api.junctionPos(L.a) : api.junctionPos(L.b);
    const dest = push ? far : mid;
    const anchor = driveTo(ctx, b, [dest[0], dest[1], dest[2]]);
    const arrived = api.hdist(body.pos, dest) < 6;
    api.write(rec, body, {
      role: "lane",
      reason: rec._laneRotated ? R.LANE_ROTATE
        : (push ? R.LANE_PUSH : (arrived ? R.LANE_HOLD : R.LANE_QUOTA)),
      anchor, anchorKind: "lane", routeUse: true,
      priority: engaged ? 0.45 : (arrived ? 0.6 : (push ? 0.8 : basePri)),
      firePolicy: "free", posture: effPosture,
      noFlank: effPosture === "control" || matchPointUs,
    });
    rec._laneRotated = false;
  }
}
