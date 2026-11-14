// core/ai/roles/dom.js [lane dom] — STRONGHOLD's role system: capturers,
// defenders, responders and roamers, re-balanced every commander pass from
// the zone board and the score.
//
// Everything read is Tier W (zone owner / capture team / bar / CONTESTED —
// exactly the HUD's zone chips and capture bar; score; clock; the public
// killfeed death ring), Tier R (team contacts harvested from teammates' own
// percepts) or teammate state (own bots' bodies, the human's position — the
// HUD shows teammate pips). Enemy head counts inside a zone are NOT public and
// are not read: "contested" is all anyone gets. The human is a wildcard the
// commander plans around (the zone it is working pulls support), never a unit
// it commands.
//
// SHAPE OF A PASS
//   1. classify the three zones from this team's side: held / threatened /
//      neutral / enemy-held, plus a capture utility per non-held zone
//      (distance, neutral is cheaper, finish a bar you started, known contacts
//      and recent own deaths near it make it dearer) — the best enemy-held
//      one is "the weakest enemy zone".
//   2. posture → quotas: CONTROL (ahead, holding 2+): one defender per held
//      zone, the rest deny the third / roam. PRESS (behind, or holding <= 1,
//      or overtime): most of the team on the primary target, one defender on
//      the most valuable held zone. Threatened held zones always get a
//      responder (two while contested). No zone gets more than 3 of us.
//   3. slots → bots, nearest-first by graph distance, latched bots keep a slot
//      that still exists (no thrash), deterministic order throughout.
//   4. orders: capturers walk the lane graph and, inside 14 m, take a spread
//      spot INSIDE the ring at priority 0.9 (feet keep moving through a fight
//      until they stand in it); defenders hold a spot inside their ring facing
//      the enemy side (0.85 while the zone is under attack); roamers sit
//      between the target and the enemy's nearest zone.

const BAND_BY_ARCH = { rifleman: [15, 35], cqb: [8, 18], marksman: [35, 80], heavy: [10, 30] };
const NEAR_ZONE_M = 14;          // inside this, a capturer takes its ring spot directly
const MAX_PER_ZONE = 3;          // anti-pile cap (bots + the human working it)
const DEATH_WINDOW_S = 15, DEATH_NEAR_M = 12;
const CONTACT_NEAR_M = 14;

function bandOf(body) { return BAND_BY_ARCH[body.archetype] || [15, 35]; }

function driveTo(ctx, b, dest) {
  const { api, t } = ctx;
  const rec = b.rec, body = b.body;
  const stale = !rec.route || !rec.route.to || api.hdist(rec.route.to, dest) > 4 ||
    (t - rec.routeAt > ctx.latchS.route && api.hdist(rec.route.to, dest) > 2);
  if (stale) {
    rec.route = api.buildRoute(body.pos, dest, api.routeCost(bandOf(body)));
    rec.routeAt = t;
  }
  const anchor = rec.route ? api.followRoute(rec, body) : null;
  return anchor || dest;
}

// k-th spread spot inside a ring (deterministic): 0 = 1.4 m toward `face`,
// then rotating by 120°. Keeps two capturers out of one grenade's radius.
function ringSpot(z, k, rad, faceX, faceZ) {
  let fx = faceX - z.pos[0], fz = faceZ - z.pos[2];
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl; fz /= fl;
  const ang = (k % 3) * (2 * Math.PI / 3) + Math.floor(k / 3) * 0.6;
  const c = Math.cos(ang), s = Math.sin(ang);
  const rr = Math.min(rad, z.r * 0.6);
  return [z.pos[0] + (fx * c - fz * s) * rr, z.pos[1], z.pos[2] + (fx * s + fz * c) * rr];
}

export function assign(ctx) {
  const { m, t, api, bots, human, sit } = ctx;
  const R = api.REASONS;
  const team = ctx.team, enemy = 1 - team;
  const zones = (m.state.mode && m.state.mode.zones) || [];
  if (!zones.length) {
    for (const b of bots) {
      api.write(b.rec, b.body, { role: "lane", reason: R.DUTY, anchor: null, priority: 0, firePolicy: "free", posture: ctx.posture });
    }
    return;
  }
  const B = m.arena && m.arena.bounds ? m.arena.bounds : null;
  const mapDiag = B ? Math.hypot(B.max[0] - B.min[0], B.max[2] - B.min[2]) : 90;

  // ---- 1. the board, from our side
  let heldUs = 0, heldThem = 0;
  for (const z of zones) { if (z.owner === team) heldUs++; else if (z.owner === enemy) heldThem++; }
  const homeZone = zones.find((z) => z.side === team) || zones[0];
  const farZone = zones.find((z) => z.side === enemy) || zones[zones.length - 1];

  // team centroid (own bots + the human): where "we" are
  let cx = 0, cz = 0, cn = 0;
  for (const b of bots) { cx += b.body.pos[0]; cz += b.body.pos[2]; cn++; }
  let humanPos = null;
  if (human && human.actor.alive) {
    humanPos = m.posOf(human.actor);
    if (humanPos) { cx += humanPos[0]; cz += humanPos[2]; cn++; }
  }
  const centroid = cn ? [cx / cn, 0, cz / cn] : homeZone.pos;

  const deathsNear = (z) => {
    let n = 0;
    for (const d of api.deathRing) {
      if (d.team !== team || t - d.t > DEATH_WINDOW_S) continue;
      if (api.hdist(d.pos, z.pos) <= DEATH_NEAR_M) n++;
    }
    return n;
  };
  const contactsNear = (z) => (ctx.gid ? api.comms.contactWeightNear(ctx.gid, t, z.pos[0], z.pos[2], CONTACT_NEAR_M) : 0);
  const threatened = (z) => z.owner === team && (z.contested || (z.capTeam === enemy && z.prog > 0));

  // the zone the human is working (teammates come and help)
  let humanZone = null;
  if (humanPos) {
    for (const z of zones) {
      if (api.hdist(humanPos, z.pos) <= z.r + 5 && Math.abs((humanPos[1] || 0) - z.pos[1]) < 3) { humanZone = z; break; }
    }
  }

  const capU = (z) => {
    if (z.owner === team) return -Infinity;
    let u = -1.4 * api.navDist(centroid, z.pos) / mapDiag;
    if (z.owner === -1) u += 0.55;                                  // no neutralise leg
    if (z.capTeam === team && z.prog > 0) u += 0.3 + 0.5 * z.prog;   // finish the bar
    if (z.side === team) u += 0.35; else if (z.side === -1) u += 0.15;
    u -= 0.5 * Math.min(2, contactsNear(z));
    u -= 0.3 * Math.min(3, deathsNear(z));
    if (humanZone === z && z.owner !== team) u += 0.6;             // back the human up
    return u;
  };
  const cands = zones.filter((z) => z.owner !== team).map((z) => ({ z, u: capU(z) }))
    .sort((a, b) => (b.u - a.u) || (a.z.id < b.z.id ? -1 : 1));
  const primary = cands.length ? cands[0].z : null;
  const secondary = cands.length > 1 ? cands[1].z : null;

  // ---- 2. posture → slots
  const N = bots.length;
  const diff = sit.us - sit.them;
  const ot = m.phase === "overtime";
  const remaining = Math.max(0, (sit.timeLimit || 600) - sit.elapsed);
  let posture;
  if (ot) posture = "press";
  else if (heldUs === zones.length) posture = "lock";
  else if (diff >= 0 && heldUs >= 2) posture = "control";
  else if (diff < 0 || heldUs <= 1 || (remaining < 60 && diff <= 0)) posture = "press";
  else posture = "balanced";

  const slots = []; // {role, zone, reason, kind}
  const perZone = new Map();
  const humanLoad = (z) => (humanZone === z ? 1 : 0);
  const room = (z) => MAX_PER_ZONE - (perZone.get(z) || 0) - humanLoad(z);
  const add = (role, z, reason, kind) => {
    if (slots.length >= N) return false;
    if (z && room(z) <= 0) return false;
    slots.push({ role, z, reason, kind });
    if (z) perZone.set(z, (perZone.get(z) || 0) + 1);
    return true;
  };

  // (a) responders: every threatened held zone, two while it is contested
  const heldList = zones.filter((z) => z.owner === team);
  heldList.sort((a, b) => (a.side === team ? -1 : 0) - (b.side === team ? -1 : 0) || (a.id < b.id ? -1 : 1));
  for (const z of heldList) {
    if (!threatened(z)) continue;
    add("defend", z, R.ZONE_RESPOND, "respond");
    if (z.contested) add("defend", z, R.ZONE_RESPOND, "respond");
  }
  // (b) the human's zone gets support first (the teammates visibly help)
  if (humanZone && humanZone.owner !== team) {
    add("attack", humanZone, R.ZONE_SUPPORT, "capture");
    if (humanZone.contested || posture === "press") add("attack", humanZone, R.ZONE_SUPPORT, "capture");
  }
  // (c) quotas by posture
  const defendHeld = (k) => {
    let n = 0;
    for (const z of heldList) {
      if (n >= k) break;
      if ((perZone.get(z) || 0) > 0) { n++; continue; } // already has a responder
      if (add("defend", z, R.ZONE_DEFEND, "defend")) n++;
    }
  };
  const capture = (z, k) => {
    if (!z) return;
    for (let i = 0; i < k; i++) {
      if (!add("attack", z, z.owner === enemy ? R.ZONE_NEUTRALISE : R.ZONE_CAPTURE, "capture")) break;
    }
  };
  if (posture === "lock") {
    defendHeld(heldList.length);
  } else if (posture === "control") {
    defendHeld(Math.min(heldList.length, 2));
    capture(primary, Math.max(1, N - slots.length - 1));
  } else if (posture === "press") {
    defendHeld(heldList.length && !ot ? 1 : 0);
    const rest = N - slots.length;
    capture(primary, Math.min(MAX_PER_ZONE, Math.max(2, rest - (rest >= 4 ? 1 : 0))));
    if (secondary && N - slots.length >= 2) capture(secondary, 1);
  } else {
    defendHeld(1);
    capture(primary, 2);
  }
  // (d) everyone left roams (or caps the secondary when there is nothing to roam toward)
  while (slots.length < N) {
    if (!add("lane", null, R.ZONE_ROAM, "roam")) break;
  }

  // ---- 3. slots → bots (latched bots keep a matching slot; nearest-first)
  const free = bots.slice();
  const assigned = new Map(); // b -> slot
  const slotKey = (s) => s.kind + ":" + (s.z ? s.z.id : "-");
  // pass A: latches
  for (const s of slots) {
    const key = slotKey(s);
    let pick = -1;
    for (let i = 0; i < free.length; i++) {
      const rec = free[i].rec;
      if (rec._domKey === key && api.latched(rec)) { pick = i; break; }
    }
    if (pick >= 0) { assigned.set(free[pick], s); free.splice(pick, 1); s.taken = true; }
  }
  // pass B: nearest free bot per remaining slot, slot order = priority order
  for (const s of slots) {
    if (s.taken) continue;
    const ref = s.z ? s.z.pos : (primary ? primary.pos : farZone.pos);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < free.length; i++) {
      const d = api.navDist(free[i].body.pos, ref);
      if (d < bestD - 1e-9) { bestD = d; best = i; }
    }
    if (best < 0) break;
    assigned.set(free[best], s);
    free.splice(best, 1);
    s.taken = true;
  }

  // ---- 4. orders
  const spotK = new Map();
  const enemyRef = farZone.pos;
  for (const b of bots) {
    const s = assigned.get(b);
    const rec = b.rec, body = b.body;
    const engaged = api.engagedNow(body);
    if (!s) {
      api.write(rec, body, { role: "lane", reason: R.ZONE_ROAM, anchor: null, priority: 0, firePolicy: "free", posture });
      continue;
    }
    rec._domKey = slotKey(s);
    if (s.kind === "roam") {
      // between the push target and the enemy's nearest held zone (or their side)
      let ez = null, ed = Infinity;
      const from = primary ? primary.pos : homeZone.pos;
      for (const z of zones) {
        if (z.owner !== enemy || z === primary) continue;
        const d = api.hdist(from, z.pos);
        if (d < ed) { ed = d; ez = z; }
      }
      const to = ez ? ez.pos : enemyRef;
      const mid = [from[0] * 0.5 + to[0] * 0.5, 0, from[2] * 0.5 + to[2] * 0.5];
      const anchor = driveTo(ctx, b, mid);
      api.write(rec, body, {
        role: "lane", reason: R.ZONE_ROAM, anchor, anchorKind: "lane", routeUse: true,
        priority: engaged ? 0.45 : 0.7, firePolicy: "free", posture,
      });
      continue;
    }
    const z = s.z;
    const k = spotK.get(z) || 0;
    spotK.set(z, k + 1);
    const dZone = api.hdist(body.pos, z.pos);
    if (s.kind === "capture") {
      if (dZone <= NEAR_ZONE_M) {
        rec.route = null;
        const spot = ringSpot(z, k, 1.6, centroid[0], centroid[2]);
        api.write(rec, body, {
          role: "attack", reason: s.reason, anchor: spot, anchorKind: "flag",
          priority: 0.9, firePolicy: "free", posture, noRetreat: dZone <= z.r,
        });
      } else {
        const anchor = driveTo(ctx, b, [z.pos[0], z.pos[1], z.pos[2]]);
        api.write(rec, body, {
          role: "attack", reason: s.reason, anchor, anchorKind: "lane", routeUse: true,
          priority: engaged ? 0.45 : 0.8, firePolicy: "free", posture,
        });
      }
      continue;
    }
    // defend / respond: a spot inside our ring, facing the enemy's side
    const hot = threatened(z);
    const spot = ringSpot(z, k, hot ? 1.5 : 2.4, enemyRef[0], enemyRef[2]);
    if (dZone > NEAR_ZONE_M + 10) {
      const anchor = driveTo(ctx, b, spot);
      api.write(rec, body, {
        role: "defend", reason: s.reason, anchor, anchorKind: "lane", routeUse: true,
        priority: engaged ? 0.45 : (hot ? 0.85 : 0.75), firePolicy: "free", posture,
      });
    } else {
      rec.route = null;
      api.write(rec, body, {
        role: "defend", reason: s.reason, anchor: spot, anchorKind: hot ? "flag" : "station",
        priority: hot ? 0.85 : (engaged ? 0.5 : 0.65), firePolicy: "free", posture,
        noFlank: true, noRetreat: hot,
      });
    }
  }
}
