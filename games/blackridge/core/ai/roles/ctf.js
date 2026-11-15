// core/ai/roles/ctf.js [W7] — CTF's role system with dynamic reassignment
// (bot_ai.md Part 7; PVP_BUILD_PLAN C9): attacker / escort / defender /
// interceptor / returner, the carrier state, the S0–S5 situation table, the
// BOTH_CARRY hold, cutoff-not-chase interception, and the stall breaker.
//
// Everything read is Tier W (flag states, dropped-flag positions, the
// 3 s / ±6 m carrier beacon, score/clock), Tier R (team contacts) or the
// bot's OWN percept. The enemy carrier's position is ONLY ever the beacon.
// The human is a wildcard the commander plans around, never a unit it
// commands: its effective role is inferred from teammate-tier facts and the
// matching quota is reduced (bot_ai §7.3).

const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const CUTOFF_MARGIN_S = 1.5;     // §7.8 — arrive and set up, not mid-stride
const STALL_WINDOW_S = 12.0;     // §7.6 — <5 m progress in 12 s → commit
const STALL_COMMIT_S = 10.0;
const HOLD_BAND = [10, 18];      // §7.6 — BOTH_CARRY hold ring

function normState(s) {
  const u = String(s || "").toUpperCase();
  if (u === "AT_STAND" || u === "HOME" || u === "ATSTAND" || u === "RETURNED") return "HOME";
  if (u === "CARRIED" || u === "TAKEN") return "CARRIED";
  if (u === "DROPPED") return "DROPPED";
  return "HOME";
}

function bandOf(body) { return BAND_BY_ARCH[body.archetype] || [15, 35]; }

function driveTo(ctx, b, dest, lengthOnly) {
  const { api, t } = ctx;
  const rec = b.rec, body = b.body;
  const cost = lengthOnly ? null : api.routeCost(bandOf(body));
  const stale = !rec.route || !rec.route.to || api.hdist(rec.route.to, dest) > 4 ||
    (lengthOnly && !rec.route._lengthOnly);
  if (stale && (t - rec.routeAt >= ctx.latchS.route || !rec.route ||
      api.hdist(rec.route.to, dest) > 12 || lengthOnly)) {
    rec.route = api.buildRoute(body.pos, dest, cost);
    if (rec.route) rec.route._lengthOnly = !!lengthOnly;
    rec.routeAt = t;
  }
  const anchor = rec.route ? api.followRoute(rec, body) : null;
  return anchor || dest;
}

// a defender's post: a waypoint on an approach lane 8–18 m from the stand
function approachAnchor(ctx, standHome, laneIds, k) {
  const { api, g } = ctx;
  if (!laneIds || !laneIds.length) return standHome;
  const L = g.byId[laneIds[k % laneIds.length]];
  if (!L) return standHome;
  // order waypoints stand-outward
  const fwd = api.hdist(L.wp[0], standHome) <= api.hdist(L.wp[L.wp.length - 1], standHome);
  let best = null, bestScore = Infinity;
  for (let i = 0; i < L.wp.length; i++) {
    const wp = L.wp[fwd ? i : L.wp.length - 1 - i];
    const d = api.hdist(wp, standHome);
    if (d >= 8 && d <= 18) {
      const s = Math.abs(d - 12);
      if (s < bestScore) { bestScore = s; best = wp; }
    }
  }
  return best || L.wp[fwd ? Math.min(1, L.wp.length - 1) : Math.max(0, L.wp.length - 2)];
}

// §7.8 — interceptors cut off, they do not chase. Returns {wp, margin}|null.
function solveCutoff(ctx, b, beacon, enemyStandHome) {
  const { api, g } = ctx;
  const nl = api.nearestLane(beacon.pos);
  if (!nl) return null;
  const jStand = api.nearestJunction(enemyStandHome);
  // carrier's next junction: the end of its lane nearer (by graph) the stand
  const costA = api.junctionPath(nl.lane.a, jStand, null);
  const costB = api.junctionPath(nl.lane.b, jStand, null);
  const nextJ = (costA ? costA.cost : Infinity) <= (costB ? costB.cost : Infinity) ? nl.lane.a : nl.lane.b;
  const p = api.junctionPath(nextJ, jStand, null);
  // remaining polyline: beacon → nextJ → … → stand
  const wps = [api.junctionPos(nextJ)];
  if (p) {
    const flat = api.flattenLegs(p.legs);
    for (const w of flat.wps) wps.push(w);
  }
  wps.push(enemyStandHome);
  let along = 0, prev = beacon.pos;
  let best = null, bestMargin = -Infinity;
  for (const wp of wps) {
    along += api.hdist(prev, wp);
    prev = wp;
    // conservative: assume the carrier WALKS (4.6) — under-committing errs
    // toward the human (§7.8.2); we blend walk/sprint (5.5) for ourselves
    const etaThem = along / ctx.speeds.walk;
    const etaMe = api.navDist(b.body.pos, wp) / ctx.speeds.blend;
    const margin = etaThem - etaMe;
    if (margin > bestMargin) { bestMargin = margin; best = wp; }
  }
  if (!best || bestMargin < CUTOFF_MARGIN_S) return null;
  return { wp: best, margin: bestMargin };
}

// 2026-11 CTF team play — escort stations on the carrier's REAL walk. The
// carrier's anchor is the stand and its route is its own nav path (a team-
// mate's plan: "coming home via the yard"), so the stations are solved on
// that path: POINT ~14 m ahead and a second gun ~6 m ahead (they meet what
// waits on the way home first), TRAIL on the carrier's own footprints a few
// seconds back (always walkable; first to the flag if the carrier drops it).
// The old solver read `rec.route.wps`, which the AC-13 carrier never has —
// every station collapsed onto the carrier itself (measured: escorts 23-38 m
// behind the carrier, 20-29% of samples ahead of it).
function pathStations(ctx, carrierPos, pathWps, trailPos) {
  const { api } = ctx;
  const wps = [carrierPos];
  if (pathWps) for (const w of pathWps) wps.push(w);
  const along = (dist) => {
    let acc = 0;
    for (let i = 1; i < wps.length; i++) {
      const seg = api.hdist(wps[i - 1], wps[i]);
      if (acc + seg >= dist) {
        const f = seg > 1e-6 ? (dist - acc) / seg : 0;
        return [wps[i - 1][0] + (wps[i][0] - wps[i - 1][0]) * f, wps[i][1],
          wps[i - 1][2] + (wps[i][2] - wps[i - 1][2]) * f];
      }
      acc += seg;
    }
    return wps[wps.length - 1].slice();
  };
  const out = [along(14), along(6)];
  out.push(trailPos ? trailPos.slice() : carrierPos.slice());
  return out;
}

// escort stations solved against the carrier's route (§7.7)
function stations(ctx, carrierPos, routeWps) {
  const { api } = ctx;
  const out = [];
  let ci = 0, cd = Infinity;
  const wps = routeWps && routeWps.length ? routeWps : [carrierPos];
  for (let i = 0; i < wps.length; i++) {
    const d = api.hdist(wps[i], carrierPos);
    if (d < cd) { cd = d; ci = i; }
  }
  const along = (dist) => {
    let acc = 0, prev = carrierPos;
    if (dist >= 0) {
      for (let i = ci; i < wps.length; i++) {
        acc += api.hdist(prev, wps[i]);
        prev = wps[i];
        if (acc >= dist) return wps[i];
      }
      return wps[wps.length - 1];
    }
    for (let i = ci; i >= 0; i--) {
      acc += api.hdist(prev, wps[i]);
      prev = wps[i];
      if (acc >= -dist) return wps[i];
    }
    return wps[0];
  };
  const point = along(15);
  out.push(point); // POINT — 12–18 m ahead
  // WING — lateral on the route direction
  const dirRef = point !== carrierPos ? point : (wps[Math.min(ci + 1, wps.length - 1)] || carrierPos);
  let dx = dirRef[0] - carrierPos[0], dz = dirRef[2] - carrierPos[2];
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  out.push([carrierPos[0] - dz * 10, carrierPos[1], carrierPos[2] + dx * 10]);
  out.push(along(-12)); // TRAIL
  // enforce ≥8 m pairwise (one grenade never takes two escorts — §7.7)
  for (let i = 1; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      if (api.hdist(out[i], out[j]) < 8) {
        out[i] = [out[i][0] - dz * 9, out[i][1], out[i][2] + dx * 9];
      }
    }
  }
  return out;
}

// 2026-11: the on-flag defender's post — the cover node inside 3-8 m of the
// stand that faces the enemy side best (same scoring as STRONGHOLD's ring
// holders); none: 3 m off the stand toward the enemy stand.
function flagPost(ctx, ourStand, theirStand) {
  const { api } = ctx;
  const cs = ctx.sim && ctx.sim.colliders && ctx.sim.colliders.cover;
  let best = null, bestS = -Infinity;
  if (cs) {
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const d = api.hdist(c.pos, ourStand);
      if (d < 2.5 || d > 8 || Math.abs((c.pos[1] || 0) - (ourStand[1] || 0)) > 1.2) continue;
      const ex = theirStand[0] - c.pos[0], ez = theirStand[2] - c.pos[2];
      const el = Math.hypot(ex, ez) || 1;
      const f = c.dir ? (c.dir[0] * ex + c.dir[2] * ez) / el : 0;
      const sc = f - d * 0.08;
      if (sc > bestS) { bestS = sc; best = c.pos; }
    }
  }
  if (best) return [best[0], best[1], best[2]];
  const dx = theirStand[0] - ourStand[0], dz = theirStand[2] - ourStand[2], dl = Math.hypot(dx, dz) || 1;
  return [ourStand[0] + dx / dl * 3, ourStand[1], ourStand[2] + dz / dl * 3];
}

// 2026-11 CTF team play — the stand-off hide (BOTH_CARRY). The carrier used
// to hold ON an approach lane 10-18 m off its stand: exactly where every enemy
// attacker walks in (measured: carriers killed while unable to score were
// 90%+ of all carrier deaths). It now hides at a cover node inside the same
// 10-18 m band, as deep on its own side as the band allows, away from team
// contacts and recent team deaths; latched with hysteresis so it does not
// hop between nodes. No cover node in the band: the old lane anchor.
function hideSpot(ctx, rec, ourStand, theirStand) {
  const { api, t } = ctx;
  const cs = ctx.sim && ctx.sim.colliders && ctx.sim.colliders.cover;
  if (!cs || !cs.length) return null;
  const score = (p) => {
    let sc = api.hdist(p, theirStand) * 0.5;
    if (ctx.gid) sc -= 12 * api.comms.contactWeightNear(ctx.gid, t, p[0], p[2], 14);
    for (const d of api.deathRing) {
      if (d.team === ctx.team && t - d.t <= 15 && api.hdist(d.pos, p) <= 10) sc -= 8;
    }
    return sc;
  };
  let best = null, bestS = -Infinity;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const d = api.hdist(c.pos, ourStand);
    if (d < HOLD_BAND[0] || d > HOLD_BAND[1]) continue;
    if (Math.abs((c.pos[1] || 0) - (ourStand[1] || 0)) > 1.5) continue;
    const sc = score(c.pos);
    if (sc > bestS) { bestS = sc; best = c.pos; }
  }
  if (!best) return null;
  if (rec._hide && rec._hideT > t - 30) {
    const keep = score(rec._hide);
    if (keep > bestS - 6) return rec._hide;
  }
  rec._hide = [best[0], best[1], best[2]];
  rec._hideT = t;
  return rec._hide;
}

// 2026-11 CTF team play — the carrier picks its way home among the two or
// three lane-graph routes (shortest, then shortest with the previous routes'
// lanes penalised), scored by length plus what the team knows about each:
// fresh contacts (Tier R) and team deaths (public killfeed) along it. A
// carrier that knows of no threat takes the shortest walk (the real nav path
// to the stand — AC-13, a lone carrier on an empty map, still holds), but
// against a live enemy team it varies its route like a human runner: the
// interceptors' cutoff solves the SHORTEST route home (measured: carriers
// died mostly in the last quarter of the run, where the cutoffs converge).
// Returns a via-point to walk to first, or null (walk straight to the stand).
function carrierVia(ctx, b, ourStand, enemyLive) {
  const { api, t, g } = ctx;
  const rec = b.rec, body = b.body;
  if (rec._via && rec._via.until > t && api.hdist(body.pos, rec._via.wp) > 6) return rec._via.wp;
  if (rec._via && api.hdist(body.pos, rec._via.wp) <= 6) rec._viaDoneT = t;
  rec._via = null;
  if (api.hdist(body.pos, ourStand) < 30) return null;
  if (rec._viaDoneT != null && t - rec._viaDoneT < 12) return null; // one detour at a time
  if (rec._viaPickT != null && t - rec._viaPickT < 3) return null;
  rec._viaPickT = t;
  if (!g || !g.jNames || !g.jNames.length) return null;
  const ja = api.nearestJunction(body.pos), jb = api.nearestJunction(ourStand);
  if (!ja || !jb || ja === jb) return null;
  const threatOf = (laneIds) => {
    let w = 0;
    for (const id of laneIds) {
      const L = g.byId[id];
      if (!L) continue;
      for (let i = 0; i < L.wp.length; i += 2) {
        const p = L.wp[i];
        if (ctx.gid) w += api.comms.contactWeightNear(ctx.gid, t, p[0], p[2], 10);
        for (const d of api.deathRing) if (d.team === ctx.team && t - d.t <= 15 && api.hdist(d.pos, p) <= 10) w += 0.7;
      }
    }
    return w;
  };
  const cands = [];
  const pen = new Map();
  for (let k = 0; k < 3; k++) {
    const p = api.junctionPath(ja, jb, (L) => L._len * (pen.get(L.id) || 1));
    if (!p) break;
    let len = 0;
    const ids = [];
    for (const e of p.legs) { len += e.lane._len; ids.push(e.lane.id); pen.set(e.lane.id, (pen.get(e.lane.id) || 1) * 3); }
    const key = ids.join(",");
    if (cands.some((c) => c.key === key)) continue;
    cands.push({ legs: p.legs, len, ids, key, threat: threatOf(ids) });
  }
  if (cands.length < 2) return null;
  const base = cands[0];
  // a human runner's variety: against a live team, an alternative no more
  // than 35% longer is taken a third of the time even with no known threat
  const vary = enemyLive >= 2 && api.rng() < 0.34;
  let best = base, bestS = base.len + 30 * base.threat;
  for (let k = 1; k < cands.length; k++) {
    const c = cands[k];
    if (c.len > base.len * 1.6 + 15) continue;
    let sc = c.len + 30 * c.threat;
    if (vary && c.len <= base.len * 1.35 + 8 && c === cands[1]) sc -= base.len * 0.5;
    if (sc < bestS - 4) { bestS = sc; best = c; }
  }
  if (best === base) return null;
  // the via-point: the middle of the first lane the alternative does not share
  let L = null;
  for (const e of best.legs) if (!base.ids.includes(e.lane.id)) { L = e.lane; break; }
  if (!L) return null;
  const wp = L.wp[Math.floor(L.wp.length / 2)];
  rec._via = { wp: [wp[0], wp[1], wp[2]], until: t + 14 };
  return rec._via.wp;
}

export function assign(ctx) {
  const { m, t, api, bots, human, posture, sit } = ctx;
  const R = api.REASONS;
  const flags = m.state.flags || [];
  const B = m.arena && m.arena.bounds ? m.arena.bounds : null;
  const mapDiag = B ? Math.hypot(B.max[0] - B.min[0], B.max[2] - B.min[2]) : 90;

  let ourFlag = null, theirFlag = null;
  for (const f of flags) {
    if (f.team === ctx.team) ourFlag = f; else theirFlag = f;
  }
  if (!ourFlag || !theirFlag) {
    // W8 not landed / no flag data: duty passthrough only
    for (const b of bots) {
      const duty = b.actor.duty;
      api.write(b.rec, b.body, {
        role: "lane", reason: R.DUTY,
        anchor: duty && duty.target ? duty.target.slice() : null,
        priority: duty ? 0.6 : 0, firePolicy: "free", posture,
      });
    }
    return;
  }

  const ourS = normState(ourFlag.state);
  const theirS = normState(theirFlag.state);
  const ourStand = ourFlag.home;
  const theirStand = theirFlag.home;
  const ownApproach = ctx.team === 0 ? (ctx.g.approaches.A_STAND || []) : (ctx.g.approaches.B_STAND || []);

  // who carries? (flag.carrier is Tier W — the HUD names the carrier's team)
  const carrierWho = theirS === "CARRIED" ? theirFlag.carrier : null; // our side's carrier
  const humanIsCarrier = carrierWho === "P" && ctx.team === 0;
  let carrierBot = null;
  if (carrierWho != null && !humanIsCarrier) {
    for (const b of bots) if (b.body.id === carrierWho) carrierBot = b;
  }
  const enemyCarrying = ourS === "CARRIED";
  const beacon = enemyCarrying ? api.beacons.get(ourFlag.id) || null : null;

  // human wildcard inference (never commanded)
  let humanRole = null;
  let humanPos = null;
  if (human && human.actor.alive && ctx.team === 0) {
    humanPos = m.posOf(human.actor);
    if (humanIsCarrier) humanRole = "carry";
    else if (humanPos && api.hdist(humanPos, ourStand) <= 15) humanRole = "defend";
    // 2026-11: "attack" only when the human is actually forward (nearer their
    // stand than ours). A human at spawn / in midfield used to cancel one of
    // the bots' attack slots, so a team whose human held back sent one runner.
    else if (humanPos && api.navDist(humanPos, theirStand) < api.navDist(humanPos, ourStand)) humanRole = "attack";
  }

  // ---- quotas per situation (bot_ai §7.3), human-adjusted
  const q = { attack: 0, defend: 0, escort: 0, intercept: 0, return: 0, float: 0 };
  // S0 - 2026-11: three go (a grab with two escorts already beside it), one
  // holds ON the flag (flagPost), one floats; was 2 / 2 / 1
  if (ourS === "HOME" && theirS === "HOME") { q.attack = 3; q.defend = 1; q.float = 1; }               // S0
  else if (ourS === "HOME" && theirS === "CARRIED") { q.escort = 2; q.defend = 2; q.float = 1; }        // S1
  else if (ourS === "HOME" && theirS === "DROPPED") { q.attack = 2; q.defend = 2; q.float = 1; }        // S5
  // S2 — 2026-11: the empty stand is not defended (nothing to capture there:
  // the enemy scores at THEIR stand); the slot goes to a second attacker, so
  // a grab of theirs forces the stand-off instead of conceding the capture
  else if (ourS === "CARRIED" && theirS === "HOME") { q.attack = 2; q.defend = 0; q.intercept = 3; }    // S2
  else if (ourS === "CARRIED" && theirS === "CARRIED") { q.escort = 1; q.intercept = 3; q.float = 1; }  // S3
  else if (ourS === "CARRIED" && theirS === "DROPPED") { q.attack = 1; q.intercept = 3; q.float = 1; }
  else if (ourS === "DROPPED") {
    // S4 overlay: 1–2 nearest return; the rest per the matching row
    q.return = Math.min(2, Math.max(1, bots.length - 2));
    if (theirS === "CARRIED") { q.escort = 2; q.defend = 1; }
    else if (theirS === "DROPPED") { q.attack = 1; q.defend = 1; q.float = 1; }
    else { q.attack = 1; q.defend = 2; }
  }

  // §7.10 score/clock: stop defending when a capture is unanswerable; sit on
  // a winning lead. §3.3 respawn ledger reweights toward attack.
  const remaining = Math.max(0, (sit.timeLimit || 720) - sit.elapsed);
  const tRound = 35;
  if (sit.them - sit.us >= 2 && remaining < tRound * 2) {
    q.attack = Math.max(q.attack, 3); q.defend = Math.min(q.defend, 1); q.escort = Math.min(q.escort, 1);
  } else if (sit.us - sit.them >= 2 && remaining < 60) {
    q.defend = Math.max(q.defend, 4); q.attack = Math.min(q.attack, 1); q.float = 0;
  } else if (posture === "press" && ourS === "HOME") {
    q.attack = Math.max(q.attack, q.attack + 1); q.defend = Math.max(0, q.defend - 1);
  }
  if (humanRole === "defend") q.defend = Math.max(0, q.defend - 1);
  else if (humanRole === "attack") q.attack = Math.max(0, q.attack - 1);

  // ---- pool = bots minus the carrier (a state, not an assignment)
  const pool = [];
  for (const b of bots) if (b !== carrierBot) pool.push(b);

  const inFight = (b) => (api.engagedNow(b.body) ? 1 : 0);
  const hpFrac = (b) => (b.body.hp || 100) / 100;

  // pre-solve cutoffs once per bot (used by utility AND the write)
  const cut = new Map();
  if (enemyCarrying && beacon) {
    for (const b of pool) cut.set(b, solveCutoff(ctx, b, beacon, theirStand));
  }

  // dropped-flag return target
  const dropPos = ourS === "DROPPED" && ourFlag.pos ? ourFlag.pos : null;
  const theirDropPos = theirS === "DROPPED" && theirFlag.pos ? theirFlag.pos : null;

  const util = {
    return: (b) => (dropPos ? 2.0 * (1 - api.navDist(b.body.pos, dropPos) / mapDiag) : -9),
    intercept: (b) => 1.4 * (cut.get(b) ? 1 : 0) + 0.4 * hpFrac(b),
    escort: (b) => {
      const cp = humanIsCarrier ? humanPos : (carrierBot ? carrierBot.body.pos : null);
      if (!cp) return -9;
      return 1.5 * (1 - api.navDist(b.body.pos, cp) / mapDiag) + 0.7 * hpFrac(b) - 1.0 * inFight(b);
    },
    defend: (b) => 1.3 * (1 - api.navDist(b.body.pos, ourStand) / mapDiag) + 0.3 * (1 - hpFrac(b)),
    attack: (b) => 1.2 + 0.8 * hpFrac(b) - 0.9 * api.navDist(b.body.pos, theirDropPos || theirStand) / mapDiag,
    float: () => 0.1,
  };

  // greedy fill, highest-leverage roles first (u(return) largest on purpose)
  const order = ["return", "intercept", "escort", "defend", "attack", "float"];
  const assigned = new Map(); // b → role
  for (const role of order) {
    let want = q[role];
    // F1 latch-break selectivity: with the W7 preempt-limiter fixed, Tier-W
    // events actually deliver preempt passes — and DEATHS are Tier-W, so a
    // team preempts every few seconds all match. A preempt that overrides
    // every latch reshuffled the whole team that often, and attack runs
    // never completed (measured: captures DROPPED after the limiter fix —
    // 6/20 capture-less seeds). Only the flag-critical roles may break a
    // live latch on preempt (AC-15's duel-breaking intercept, S4's return);
    // the rest honor §3.4 and rebalance when their latch expires.
    const latchBreak = role === "return" || role === "intercept";
    // 2026-11: escorts may also break a latch on the grab (a preempt), but
    // only for an operator already near the carrier - the attack partner who
    // was with it at the stand. Escort slots used to go to whoever was
    // unlatched (fresh respawns at the far spawn: escorts 30+ m behind).
    const escortCp = role === "escort" ? (humanIsCarrier ? humanPos : (carrierBot ? carrierBot.body.pos : null)) : null;
    while (want > 0 && assigned.size < pool.length) {
      let best = null, bestU = -Infinity;
      for (const b of pool) {
        if (assigned.has(b)) continue;
        // role latch (§3.4): a latched bot resists reassignment unless a
        // preempting event fired this pass AND the role may break latches
        const nearBreak = escortCp && api.preempt && api.hdist(b.body.pos, escortCp) <= 30 &&
          b.rec.role !== "return" && b.rec.role !== "intercept";
        if (!(api.preempt && latchBreak) && !nearBreak && api.latched(b.rec) && b.rec.role !== role) continue;
        const u = util[role](b);
        if (u > bestU) { bestU = u; best = b; }
      }
      if (!best || bestU <= -9) break;
      assigned.set(best, role);
      want--;
    }
  }
  // F1 (T-CTF-1 finding): the attack quota is the capture engine — the fill
  // order tries return/intercept/escort/defend first, and with permanent
  // latches a small pool can leave attack COMPLETELY unfilled forever (a
  // lone bot latched 'defend' never grabbed a wholly undefended flag). On a
  // preempt pass, if attack got zero fills, steal the best candidate from
  // the lower-leverage holders (defend/float/lane).
  if (api.preempt && q.attack > 0 && ourS !== "CARRIED") {
    let hasAttack = false;
    for (const r2 of assigned.values()) if (r2 === "attack") hasAttack = true;
    for (const b of pool) if (!assigned.has(b) && b.rec.role === "attack") hasAttack = true;
    if (!hasAttack) {
      let best = null, bestU = -Infinity;
      for (const b of pool) {
        const cur = assigned.get(b);
        if (cur && cur !== "defend" && cur !== "float") continue;
        if (b.rec.role != null && !["defend", "float", "lane", "attack"].includes(b.rec.role)) continue;
        const u = util.attack(b);
        if (u > bestU) { bestU = u; best = b; }
      }
      if (best) assigned.set(best, "attack");
    }
  }
  // leftovers float
  for (const b of pool) if (!assigned.has(b)) assigned.set(b, "float");

  // ---- carrier route (for escorts): the human's inferred route, or the
  // carrier bot's own route (built below before escorts read it)
  let carrierRouteWps = null;
  let carrierPos = null;
  let enemyLiveN = 0;
  for (const a of m.actors) if (a.alive && a.team !== ctx.team) enemyLiveN++;
  // the carrier's footprints (2 Hz, last ~1.5 s): the TRAIL escort's station
  const trailOf = (key, pos) => {
    const tr = ctx.st._ctfTrail || (ctx.st._ctfTrail = new Map());
    let a = tr.get(key);
    if (!a || a.who !== carrierWho) { a = { who: carrierWho, pts: [] }; tr.set(key, a); }
    a.pts.push([pos[0], pos[1], pos[2]]);
    if (a.pts.length > 4) a.pts.shift();
    return a.pts[0];
  };

  // ================================================================ carrier
  if (carrierBot) {
    const b = carrierBot;
    const rec = b.rec, body = b.body;
    carrierPos = body.pos;
    const canScore = ourS === "HOME"; // rule 2 — own flag must be home
    if (!canScore) {
      // S3/S2-hold: 10–18 m off our stand, near enough to score the moment
      // our flag comes home, far enough not to be camped (§7.6)
      const hide = hideSpot(ctx, rec, ourStand, theirStand);
      const hold = hide || approachAnchor(ctx, ourStand, ownApproach, 0);
      const d = api.hdist(hold, ourStand);
      const anchor = d >= HOLD_BAND[0] && d <= HOLD_BAND[1] ? hold
        : [ourStand[0] + 14 * ((hold[0] - ourStand[0]) / (d || 1)), ourStand[1],
           ourStand[2] + 14 * ((hold[2] - ourStand[2]) / (d || 1))];
      rec.route = null;
      rec._via = null;
      // 2026-11: hiding, not holding a lane - the carrier fights what finds it
      // (free fire inside 25 m, defensive beyond: a long duel gives it away)
      // and runs to the hide at the base sprint
      const far = api.hdist(body.pos, anchor) > 8;
      api.write(rec, body, {
        role: "carry", reason: R.HOLD_NEAR_STAND, anchor, anchorKind: "station",
        priority: far ? 0.95 : 0.8, firePolicy: "defensive", selfDefenseM: 25, posture,
        noRetreat: true, noFlank: true, noGrenade: true, holdS: 2, sprint: far,
      });
      carrierRouteWps = body._brain && body._brain.path ? body._brain.path.slice(body._brain.pathI || 0) : null;
    } else {
      // stall breaker (§7.6): <5 m progress toward the stand in 12 s → commit
      const dHome = api.navDist(body.pos, ourStand);
      if (t - rec.progT >= STALL_WINDOW_S) {
        if (rec.progD - dHome < 5 && t >= rec.stallUntil) rec.stallUntil = t + STALL_COMMIT_S;
        rec.progD = dHome; rec.progT = t;
      } else if (dHome < rec.progD - 5) { rec.progD = dHome; rec.progT = t; }
      const stalled = t < rec.stallUntil;
      // F1 (T-CTF-1 monotonic-window finding): the junction-graph route
      // detoured the carrier AWAY from home by up to 7.9 m inside a 10 s
      // window (same lane-approximation error as the returner's). Inside
      // 30 m of home the anchor is the stand itself — the real nav path is
      // exact and monotone at that range; beyond it the exposure-aware
      // route still picks the lane.
      // F1 (AC-13 monotonic bar): the carrier takes NO lane-graph route at
      // all — every cost variant detoured it away from home by 8-10 m inside
      // a 10 s window (junction-path approximation + lane flattening, even
      // lengthOnly). The anchor is the stand itself: the bot's REAL nav path
      // is optimal, so nav-distance-home falls monotonically by construction.
      // The carrier's safety is the escorts' job (§7.7); its own job is the
      // shortest walk home. Escort stations fall back to carrier-pos rings.
      // 2026-11 CTF team play: ... unless the carrier picks one of the
      // alternative routes home (carrierVia above) - then it walks to that
      // route's via-point first, on the same real nav path, and the stand after.
      const via = stalled ? null : carrierVia(ctx, b, ourStand, enemyLiveN);
      const anchor = via ? via.slice() : [ourStand[0], ourStand[1], ourStand[2]];
      rec.route = null;
      // pace the run with the escort: while an escort is close behind (it is
      // running up to its POINT station ahead) the carrier walks, so the
      // escort gets in front; alone, with the escort ahead, or on the last
      // 25 m it runs. A carrier that out-sprints its escort meets the
      // midfield gun alone (measured: escorts 16-21 m off the carrier).
      let escortBehind = false;
      const dHomeE = api.hdist(body.pos, ourStand);
      for (const [eb, er] of assigned) {
        if (er !== "escort") continue;
        const dc = api.hdist(eb.body.pos, body.pos);
        if (dc <= 28 && api.hdist(eb.body.pos, ourStand) > dHomeE - 4) escortBehind = true;
      }
      const runNow = stalled || dHomeE <= 25 || !escortBehind;
      api.write(rec, body, {
        role: "carry", reason: stalled ? R.STALL_BREAKER : via ? R.EVADE : R.CARRY,
        anchor, anchorKind: via ? "cutoff" : "stand", routeUse: false, sprint: runNow,
        priority: stalled ? 1.0 : 0.95,
        // 2026-11 review: 12 -> 22 m. The carrier shoots back at what blocks
        // its way home (it now fires on the walk, botfsm fireOnMove), but
        // still does not start long-range duels (defensive policy).
        firePolicy: "defensive", selfDefenseM: 22, posture,
        noRetreat: true, noFlank: true, noGrenade: true, holdS: 2,
      });
      carrierRouteWps = body._brain && body._brain.path ? body._brain.path.slice(body._brain.pathI || 0) : null;
      // honest calls (§7.6): flag's up / carrier sector / escort me
      if (t - rec.lastBarkT > 6) {
        rec.lastBarkT = t;
        api.bark(body, rec._barkedTaken ? "carrier" : "flagtaken");
        rec._barkedTaken = true;
      }
      if (body.hp < 50 && api.engagedNow(body)) {
        api.bark(body, "escortme");
        if (ctx.gid) api.comms.call(ctx.gid, "escortme", body.id, t);
      }
    }
  } else if (humanIsCarrier && humanPos) {
    carrierPos = humanPos;
    const r = api.buildRoute(humanPos, [ourStand[0], ourStand[1], ourStand[2]], null);
    carrierRouteWps = r ? r.wps : null;
  }

  // ================================================================ the pool
  let defendK = 0, escortK = 0;
  const trailPos = carrierPos ? trailOf(ctx.team, carrierPos) : null;
  const carrierHolding = !!carrierBot && ourS !== "HOME";
  let escortStations = null;
  if (carrierPos && carrierHolding) {
    // stand-off bodyguard: between the hide and the enemy's side, 5 m out
    const hb = carrierBot.rec._hide || carrierPos;
    const dx = theirStand[0] - hb[0], dz = theirStand[2] - hb[2], dl = Math.hypot(dx, dz) || 1;
    escortStations = [[hb[0] + dx / dl * 5, hb[1], hb[2] + dz / dl * 5], trailPos || carrierPos, carrierPos];
  } else if (carrierPos && carrierBot) escortStations = pathStations(ctx, carrierPos, carrierRouteWps, trailPos);
  else if (carrierPos) escortStations = stations(ctx, carrierPos, carrierRouteWps);
  // S1 with the carrier inbound: the home side sweeps the stand ahead of it
  const carrierInbound = !!carrierPos && ourS === "HOME" && api.navDist(carrierPos, ourStand) <= 60;
  const standContacts = [];
  if (carrierInbound && ctx.gid) {
    const cs = api.comms.contacts(ctx.gid, t, []);
    for (const c of cs) if (api.hdist(c.pos, ourStand) <= 26) standContacts.push(c.pos);
  }

  for (const b of pool) {
    const role = assigned.get(b);
    const rec = b.rec, body = b.body;
    const engaged = api.engagedNow(body);
    const combatNow = body.state === "combat" || body.state === "flank" || body.state === "suppress";
    // one-shot break bookkeeping (see the return/intercept branches): a new
    // engagement, or leaving the breaking roles, re-arms the break.
    if ((!combatNow && !engaged) || (role !== "return" && role !== "intercept")) rec._brokeFor = null;

    if (role === "return" && dropPos) {
      // F1 (T-CTF-4 finding): the junction-graph route badly over-detours
      // short trips (measured: nav 17.7 m to the drop, lane route walked the
      // returner to 22.4 m AWAY before turning). Inside 25 m the anchor is
      // the drop itself — botfsm's real nav path is exact at that range.
      // navDistApprox over-estimates in-yard trips (junction detour clamped
      // to 3x euclid — measured 45 for a real 17.7 m trip), so the direct
      // gate also accepts a short EUCLID trip: the anchor only seeds the
      // bot's REAL nav path, which routes around any wall correctly.
      const ndDrop = api.navDist(body.pos, dropPos);
      const direct = ndDrop <= 25 || api.hdist(body.pos, dropPos) <= 20;
      const anchor = direct ? [dropPos[0], dropPos[1], dropPos[2]]
        : driveTo(ctx, b, [dropPos[0], dropPos[1], dropPos[2]]);
      if (direct) rec.route = null;
      // F1 (T-CTF-2-class finding): a role write during the §7.9 hit-lock
      // used to consume the one-shot break (rec.role changed, breakFight
      // false) — the break now re-arms until it actually fires once.
      const hardBreak = combatNow && !api.neverBreak(body) &&
        ndDrop <= 40 && (rec.role !== "return" || !rec._brokeFor);
      api.write(rec, body, {
        role: "return", reason: R.RETURN_FLAG, anchor, anchorKind: "flag", routeUse: !direct,
        priority: 1.0, firePolicy: "defensive", selfDefenseM: 10, posture,
        noRetreat: true, breakFight: hardBreak, rearm: hardBreak, sprint: ndDrop > 8,
      });
      if (hardBreak) rec._brokeFor = "return";
      if (rec._lastReturnBark == null || t - rec._lastReturnBark > 8) {
        rec._lastReturnBark = t; api.bark(body, "returning");
      }
      continue;
    }

    if (role === "intercept") {
      const c = cut.get(b);
      if (c) {
        // F1 (T-CTF-2 finding): with preempts latched, a stale death event
        // can assign intercept while the duelist is inside the §7.9 hit-lock
        // — the one-shot role-transition break was consumed with breakFight
        // false and never re-offered. The break now re-arms every pass until
        // it actually fires once for this engagement.
        // (combatNow || engaged): during the very no-hit gap that makes the
        // break §7.9-legal, the FSM can sit one state outside the strict
        // combat set while the percept engagement is still live — the break
        // must not miss its only legal window over that technicality.
        const hardBreak = (combatNow || engaged) && !api.neverBreak(body) &&
          (rec.role !== "intercept" || rec._brokeFor !== "intercept");
        rec.route = null;
        api.write(rec, body, {
          role: "intercept", reason: R.CUTOFF_FEASIBLE, anchor: c.wp.slice(),
          anchorKind: "cutoff", priority: 0.9, firePolicy: "free", posture,
          noFlank: true, breakFight: hardBreak, rearm: hardBreak, holdS: 2,
          sprint: api.hdist(body.pos, c.wp) > 10,
        });
        if (hardBreak) rec._brokeFor = "intercept";
        if (rec._lastIntBark == null || t - rec._lastIntBark > 10) {
          rec._lastIntBark = t; api.bark(body, "intercept");
        }
      } else {
        // §7.8.4 — a hopeless chase is abandoned NOW: counter-attack instead
        // 2026-11 stand-off: when the enemy carrier is HOLDING (it cannot
        // score: their flag is out too) a cutoff is meaningless - there is no
        // run to cut. Hunt it at the beacon (Tier W, the human's own pip).
        if (theirS === "CARRIED" && beacon) {
          const bp = beacon.pos;
          const useRoute = api.navDist(body.pos, bp) > 30;
          const anchor = useRoute ? driveTo(ctx, b, [bp[0], bp[1], bp[2]]) : [bp[0], bp[1], bp[2]];
          if (!useRoute) rec.route = null;
          api.write(rec, body, {
            role: "intercept", reason: R.HUNT, anchor, anchorKind: "lane",
            routeUse: useRoute, priority: engaged ? 0.5 : 0.85, firePolicy: "free", posture,
            noFlank: true, sprint: api.hdist(body.pos, bp) > 15,
          });
          continue;
        }
        const dest = theirDropPos || theirStand;
        const anchor = driveTo(ctx, b, [dest[0], dest[1], dest[2]]);
        api.write(rec, body, {
          role: "attack", reason: R.CUTOFF_INFEASIBLE, anchor, anchorKind: "flag",
          routeUse: true, priority: engaged ? 0.45 : 0.8, firePolicy: "free", posture,
          sprint: !engaged && api.hdist(body.pos, dest) > 20,
        });
      }
      continue;
    }

    if (role === "escort" && escortStations) {
      const stn = escortStations[Math.min(escortK, escortStations.length - 1)];
      escortK++;
      rec.route = null;
      const dC = api.hdist(body.pos, carrierPos);
      api.write(rec, body, {
        role: "escort",
        reason: humanIsCarrier ? R.CARRIER_NEEDS_ESCORT : R.ESCORT_STATION,
        anchor: stn.slice(), anchorKind: "station",
        // 2026-11: an escort out of position runs to it (priority 0.85 keeps
        // its feet moving through a side fight); in position it fights for
        // the carrier (0.75)
        priority: dC > 18 ? 0.85 : 0.75, firePolicy: "free", posture,
        noRetreat: dC <= 20, holdS: 2, sprint: api.hdist(body.pos, stn) > 8,
      });
      continue;
    }

    if ((role === "defend" || role === "float") && carrierInbound) {
      // CLEAR_STAND: walk the stand's ground ahead of the inbound carrier -
      // to a contact the team called near it, else onto the stand's arrival
      // side (between the stand and the carrier). Free fire, no retreat.
      let tgt = null, bd = Infinity;
      for (const p of standContacts) { const d = api.hdist(body.pos, p); if (d < bd) { bd = d; tgt = p; } }
      if (!tgt) {
        const dx = carrierPos[0] - ourStand[0], dz = carrierPos[2] - ourStand[2], dl = Math.hypot(dx, dz) || 1;
        const k = defendK++ % 2 ? -1 : 1;
        tgt = [ourStand[0] + dx / dl * 7 - dz / dl * 4 * k, ourStand[1], ourStand[2] + dz / dl * 7 + dx / dl * 4 * k];
      }
      const far = api.hdist(body.pos, tgt) > 14;
      const useRoute = far && api.navDist(body.pos, tgt) > 30;
      const anchor = useRoute ? driveTo(ctx, b, [tgt[0], tgt[1], tgt[2]]) : [tgt[0], tgt[1], tgt[2]];
      if (!useRoute) rec.route = null;
      api.write(rec, body, {
        role: "defend", reason: R.CLEAR_STAND, anchor, anchorKind: "station", routeUse: useRoute,
        priority: engaged ? 0.6 : 0.8, firePolicy: "free", posture,
        noRetreat: true, sprint: far,
      });
      continue;
    }

    if (role === "defend") {
      // 2026-11: the FIRST defender holds ON the flag (a cover spot inside
      // 3-8 m of the stand, facing the enemy side; a hold leash keeps it
      // there), the rest take the approach lanes as overwatch. Both used to
      // post 8-18 m out on two of the approach lanes, and an attacker on a
      // third lane took the flag untouched (measured: 8-11 grabs a match,
      // most turning into a both-flags-out stand-off).
      const onFlag = defendK === 0;
      const anchor = onFlag ? flagPost(ctx, ourStand, theirStand) : approachAnchor(ctx, ourStand, ownApproach, defendK - 1);
      defendK++;
      const standThreat = api.comms.contactWeightNear(ctx.gid, t, ourStand[0], ourStand[2], 15) > 0;
      const leashed = api.hdist(body.pos, anchor) > 24;
      rec.route = null;
      api.write(rec, body, {
        role: "defend", reason: leashed ? R.LEASH : R.DEFEND_STAND,
        anchor: anchor.slice(), anchorKind: "station",
        priority: leashed ? 0.85 : (engaged ? 0.5 : 0.7),
        firePolicy: "free", posture,
        noRetreat: standThreat || onFlag, noFlank: true,
        leash: onFlag && api.hdist(body.pos, ourStand) <= 14 ? [ourStand[0], ourStand[1], ourStand[2], 10] : null,
        sprint: leashed,
      });
      continue;
    }

    if (role === "attack") {
      const dest = theirDropPos || theirStand;
      const near = api.hdist(body.pos, dest) <= 8;
      const anchor = near ? [dest[0], dest[1], dest[2]] : driveTo(ctx, b, [dest[0], dest[1], dest[2]]);
      api.write(rec, body, {
        role: "attack", reason: R.ATTACK_FLAG,
        anchor, anchorKind: "flag", routeUse: !near,
        // §7.4: the grab is worth a trade — priority 0.95 inside 8 m
        priority: near ? 0.95 : (engaged ? 0.45 : 0.8),
        firePolicy: "free", posture,
        sprint: !engaged && api.hdist(body.pos, dest) > 20,
      });
      continue;
    }

    // float: midfield presence biased toward the enemy stand (60 %)
    const mx = ourStand[0] * 0.4 + theirStand[0] * 0.6;
    const mz = ourStand[2] * 0.4 + theirStand[2] * 0.6;
    const anchor = driveTo(ctx, b, [mx, 0, mz]);
    api.write(rec, body, {
      role: "lane", reason: R.LANE_QUOTA, anchor, anchorKind: "lane", routeUse: true,
      priority: engaged ? 0.45 : 0.7, firePolicy: "free", posture,
    });
  }
}
